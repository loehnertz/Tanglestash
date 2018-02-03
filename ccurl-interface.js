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
}


module.exports = CcurlInterface;
