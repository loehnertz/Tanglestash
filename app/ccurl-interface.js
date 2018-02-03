/**
 * Class derived from `ccurl.interface.js`
 * by Dominik Schiener (IOTA Foundation)
 * licensed under MIT license
 * as of 3rd of February 2018
 * Source: https://github.com/iotaledger/ccurl.interface.js
 */

const Ffi = require('ffi');

const TanglestashCustomErrors = require('./tanglestash-errors');


class CcurlInterface {
    constructor(trunkTransaction, branchTransaction, minWeightMagnitude, trytes, iotaProvider, libccurl) {
        // CONSTANTS
        this.MAX_TIMESTAMP_VALUE = (Math.pow(3, 27) - 1) / 2;

        // PROPERTIES
        this.trunkTransaction = trunkTransaction;
        this.branchTransaction = branchTransaction;
        this.minWeightMagnitude = minWeightMagnitude;
        this.trytes = trytes;
        this.index = 0;
        this.previousTxHash = null;
        this.finalBundleTrytes = [];
        this.iota = iotaProvider;
        this.libccurl = libccurl || CcurlInterface.prepareCcurlProvider('.');
    }

    hash() {
        return new Promise(async (resolve, reject) => {
            await this.checkInput();
            try {
                this.loopTrytes(this.index);
            } catch (err) {
                reject(err);
            }
            setInterval(() => {
                if (this.index >= this.trytes.length) {
                    resolve(this.finalBundleTrytes.reverse());
                }
            }, 123);
        });
    };

    loopTrytes() {
        this.getBundleTrytes(this.trytes[this.index]).then(() => {
            this.index++;
            if (this.index < this.trytes.length) {
                this.loopTrytes();
            }
        }).catch((err) => {
            throw new TanglestashCustomErrors.TryteLoopingError(err.message);
        });
    }

    /**
     * LOGIC:
     * Start with last index transaction
     * Assign it the trunk / branch which the user has supplied
     * If there is a bundle, chain the bundle transactions via trunkTransaction together
     *
     * @param singleTryte The single tryte from a bundle to perform the PoW on
     * @returns {Promise}
     */
    getBundleTrytes(singleTryte) {
        return new Promise((resolve, reject) => {
            let txObject = this.iota.utils.transactionObject(singleTryte);
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
                    return new Error("Wrong bundle order. The bundle should be ordered in descending order from currentIndex");
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
                    reject(new Error("The PoW was involuntarily interrupted"));
                }

                let newTxObject = this.iota.utils.transactionObject(returnedTrytes);

                // Assign the previousTxHash to this new transaction hash
                this.previousTxHash = newTxObject.hash;
                // Push the returned trytes to the bundle array
                this.finalBundleTrytes.push(returnedTrytes);

                resolve();
            });
        });
    }

    /**
     * Checks the inputs into the class object for correctness
     */
    checkInput() {
        if (!this.libccurl.hasOwnProperty("ccurl_pow")) {
            return new Error("Hashing not available");
        }

        // inputValidator: Check if correct hash
        if (!this.iota.valid.isHash(this.trunkTransaction)) {
            return new Error("Invalid trunkTransaction");
        }

        // inputValidator: Check if correct hash
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
     * Creates an instance of a libccurl object via a dynamic library of it
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

            if (!libccurl.hasOwnProperty("ccurl_pow") ||
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
