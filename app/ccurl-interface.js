/**
 * Class derived from `ccurl.interface.js`
 * by Dominik Schiener (IOTA Foundation)
 * licensed under MIT license
 * as of 3rd of February 2018
 *
 * Source: https://github.com/iotaledger/ccurl.interface.js
 */

const Ffi = require('ffi');

const TanglestashCustomErrors = require('./tanglestash-errors');


class CcurlInterface {
    constructor(trunkTransaction, branchTransaction, trytes, minWeightMagnitude, iotaProvider, libccurl) {
        // CONSTANTS
        this.MAX_TIMESTAMP_VALUE = (Math.pow(3, 27) - 1) / 2;

        // PROPERTIES
        this.trunkTransaction = trunkTransaction;
        this.branchTransaction = branchTransaction;
        this.minWeightMagnitude = minWeightMagnitude;
        this.trytes = trytes;
        this.finishedPoW = false;
        this.index = 0;
        this.previousTxHash = null;
        this.finalBundleTrytes = [];
        this.iota = iotaProvider;
        this.libccurl = libccurl || CcurlInterface.prepareCcurlProvider('.');
    }

    /**
     * Launches the needed methods to perform the PoW.
     */
    performPoW() {
        return new Promise(async (resolve) => {
            await this.checkInput();
            this.loopTrytes(this.index);
            setInterval(() => {
                if (this.finishedPoW) resolve(this.finalBundleTrytes.reverse());
            }, 123);
        });
    };

    /**
     * Iterates over the passed trytes to perform the PoW on each of them.
     */
    loopTrytes() {
        this.getBundleTrytes(this.trytes[this.index]).then(() => {
            this.index++;
            if (this.index < this.trytes.length) {
                this.loopTrytes();
            } else {
                this.finishedPoW = true;
            }
        }).catch((err) => {
            throw new TanglestashCustomErrors.TryteLoopingError(err.message);
        });
    }

    /**
     * Performs the actual PoW.
     *
     * Logic:
     * Start with last index transaction
     * Assign it the trunk / branch which the user has supplied
     * If there is a bundle, chain the bundle transactions via trunkTransaction together
     */
    getBundleTrytes(singleTryteString) {
        return new Promise((resolve, reject) => {
            let txObject = this.iota.utils.transactionObject(singleTryteString);
            txObject.tag = txObject.tag || txObject.obsoleteTag;
            txObject.attachmentTimestamp = Date.now();
            txObject.attachmentTimestampLowerBound = 0;
            txObject.attachmentTimestampUpperBound = this.MAX_TIMESTAMP_VALUE;

            // If this is the first transaction, to be processed
            // Make sure that it's the last in the bundle and then
            // assign it the supplied trunk and branch transactions
            if (!this.previousTxHash) {
                // Check if last transaction in the bundle
                if (txObject.lastIndex !== txObject.currentIndex) {
                    return new Error('Wrong bundle order. The bundle should be ordered in descending order from currentIndex');
                }

                txObject.trunkTransaction = this.trunkTransaction;
                txObject.branchTransaction = this.branchTransaction;
            } else {
                // Chain the bundle together via the trunkTransaction (previous tx in the bundle)
                // Assign the supplied trunkTransaciton as branchTransaction
                txObject.trunkTransaction = this.previousTxHash;
                txObject.branchTransaction = this.trunkTransaction;
            }

            let newTrytes = this.iota.utils.transactionTrytes(txObject);
            this.libccurl.ccurl_pow.async(newTrytes, this.minWeightMagnitude, (err, returnedTrytes) => {
                if (err) {
                    reject(err);
                } else if (!returnedTrytes) {
                    reject(new TanglestashCustomErrors.LibccurlInterruptionError('PoW failed!'));
                }

                let newTxObject = this.iota.utils.transactionObject(returnedTrytes);

                // Assign the previousTxHash to this new transaction performPoW
                this.previousTxHash = newTxObject.performPoW;
                // Push the returned trytes to the bundle array
                this.finalBundleTrytes.push(returnedTrytes);

                resolve();
            });
        });
    }

    /**
     * Checks the inputs into the class object for correctness.
     */
    checkInput() {
        if (!this.libccurl.hasOwnProperty("ccurl_pow")) {
            return new Error("Hashing not available");
        }

        // inputValidator: Check if correct performPoW
        if (!this.iota.valid.isHash(this.trunkTransaction)) {
            return new Error("Invalid trunkTransaction");
        }

        // inputValidator: Check if correct performPoW
        if (!this.iota.valid.isHash(this.branchTransaction)) {
            return new Error("Invalid branchTransaction");
        }

        // inputValidator: Check if int
        if (!this.iota.valid.isValue(this.minWeightMagnitude)) {
            return new Error("Invalid minWeightMagnitude");
        }

        //inputValidator: Check if array of trytes
        if (!this.iota.valid.isArrayOfTrytes(this.trytes)) {
            return new Error("Invalid trytes supplied");
        }
    }

    /**
     * Creates an instance of a libccurl object via a dynamic library of it.
     *
     * @param ccurlPath The path to the dynamic library
     * @returns {Object} A libccurl object
     */
    static prepareCcurlProvider(ccurlPath) {
        if (!ccurlPath) {
            throw new Error("Path to ccurl is mandatory!");
        }

        let fullPath = ccurlPath + '/libccurl';

        try {
            let libccurl = Ffi.Library(fullPath, {
                ccurl_pow: ['string', ['string', 'int']],
                ccurl_pow_finalize: ['void', []],
                ccurl_pow_interrupt: ['void', []]
            });

            if (
                !libccurl.hasOwnProperty("ccurl_pow") ||
                !libccurl.hasOwnProperty("ccurl_pow_finalize") ||
                !libccurl.hasOwnProperty("ccurl_pow_interrupt")
            ) {
                throw new Error("Could not load hashing library.");
            }

            return libccurl;
        } catch (err) {
            throw new TanglestashCustomErrors.LibccurlCreationError(err.message);
        }
    }
}


module.exports = CcurlInterface;
