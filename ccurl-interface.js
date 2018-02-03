/**
 * Class derived from `ccurl.interface.js`
 * by Dominik Schiener (IOTA Foundation)
 * licensed under MIT license
 * as of 3rd of February 2018
 * Source: https://github.com/iotaledger/ccurl.interface.js
 */

const Ffi = require('ffi');


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
            throw err;
        });
    }
}


module.exports = CcurlInterface;
