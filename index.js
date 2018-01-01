const Fs = require("fs");
const Path = require("path");
const Randomstring = require("randomstring");
const CryptoJS = require("crypto-js");
const Marky = require("marky");
const Iota = require("iota.lib.js");
const Ccurl = require("ccurl.interface.js");


/**
 * TANGLESTASH
 * The tangle of IOTA meets BitTorrent: An algorithm to persist any file onto the tangle of IOTA
 * By Jakob Löhnertz (www.jakob.codes)
 * **/

class Tanglestash {
    /**
     * @param {String} `provider` A URI of an IOTA full node
     * @param {String} `datatype` Either 'file' or 'string' based on the data that will later be used
     * @param {String} `seed` [Optional] An IOTA wallet seed; will be automatically generated if not passed here
     */
    constructor(provider, datatype, seed) {
        // CONSTANTS
        this.IotaTransactionDepth = 4;
        this.IotaTransactionMinWeightMagnitude = 14;
        this.IotaSeedLength = 81;
        this.IotaCharset = '9ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        this.IotaTransactionSignatureMessageFragmentLength = 2187;
        this.ChunkPaddingLength = 19;
        this.ChunkTablePreviousHashLength = 109;
        this.ChunkContentLength = (this.IotaTransactionSignatureMessageFragmentLength - this.ChunkPaddingLength);
        this.ChunkTableFragmentLength = (this.ChunkContentLength - this.ChunkTablePreviousHashLength);
        this.ChunkTag = 'TANGLESTASH9999999999999999';
        this.ChunkContentKey = 'CC';
        this.TotalChunkAmountKey = 'TC';
        this.PreviousHashKey = 'PCTFH';
        this.FirstChunkKeyword = '1st';

        // PROPERTIES
        this.iota = new Iota({'provider': provider});  // Create IOTA instance utilizing the passed provider
        this.datatype = datatype || 'file';  // Set file as the default 'datatype' in case none was passed
        this.seed = seed || this.generateRandomIotaSeed();  // Generate a fresh and random IOTA seed
        this.successfulChunks = 0;
        this.totalChunkAmount = 0;
        this.chunkBundle = {};
        this.failedChunks = [];
    }

    /**
     * Retrieves data that was persisted to the tangle in the past.
     *
     * @param {String} `entryHash` The entry-hash to start the retrieval (return value from `saveToTangle()`)
     * @param {String} `secret` [Optional] A secret to decrypt the data if it was persisted with encryption beforehand
     * @returns {Promise.<*>} A file buffer or a string based on `this.datatype`
     */
    async readFromTangle(entryHash, secret) {
        try {
            let chunkTable = await this.rebuildChunkTable(entryHash);
            this.chunkBundle = await this.retrieveChunkBundle(chunkTable);
        } catch (err) {
            throw err;
        }

        let chunkContents = [];
        for (let i = 0; i < this.totalChunkAmount; i++) {
            chunkContents.push(this.chunkBundle[i]["content"]);
        }

        let datastringBase64 = chunkContents.join('');
        try {
            return this.decodeData(datastringBase64, secret);
        } catch (err) {
            throw err;
        }
    }

    /**
     * Persists data onto the tangle.
     *
     * @param {String} `data` The data as a file path or a string based on `this.datatype`
     * @param {String} `secret` [Optional] A secret to encrypt the data
     * @returns {Promise.<string>} The entry-hash for this persisted data
     */
    async saveToTangle(data, secret) {
        try {
            let datastring = this.encodeData(data, secret);
            let chunkContents = Tanglestash.chopIntoChunks(datastring, this.ChunkContentLength);
            this.potentialParentTransactions = await this.retrievePotentialParentTransactions();
            this.chunkBundle = Tanglestash.generateChunkBundle(chunkContents);
        } catch (err) {
            throw err;
        }

        let totalChunkAmount = parseInt(Object.keys(this.chunkBundle).length);
        this.successfulChunks = 0;
        this.totalChunkAmount = totalChunkAmount;

        try {
            return await this.persistChunkBundle();
        } catch (err) {
            throw err;
        }
    }

    async retrieveChunkBundle(chunkTable) {
        Object.keys(chunkTable).forEach(key => {
            this.retrieveChunk(chunkTable[key], key);
        });

        try {
            return await this.finalizeRetrievalOfChunkBundle();
        } catch (err) {
            throw err;
        }
    }

    async retrieveChunk(transactionHash, index) {
        Marky.mark('readFromTangle');

        try {
            this.chunkBundle[index] = Tanglestash.buildChunkBundleEntry(null, index);
            this.chunkBundle[index]["hash"] = transactionHash;

            let failedChunkIndex = this.failedChunks.indexOf(index);
            if (failedChunkIndex !== -1) {
                this.failedChunks.splice(failedChunkIndex, 1);
            }

            let chunk = await this.retrieveJSONFromTransaction(transactionHash);

            Marky.stop('readFromTangle');

            this.chunkBundle[index]["content"] = chunk[this.ChunkContentKey];
            this.chunkBundle[index]["retrieved"] = true;
            this.successfulChunks += 1;
            return true;
        } catch (err) {
            Marky.stop('readFromTangle');

            if (this.failedChunks.indexOf(index) === -1) {
                this.failedChunks.push(index);
            }

            console.error(err.message, transactionHash, index);
        }
    }

    finalizeRetrievalOfChunkBundle() {
        return new Promise((resolve, reject) => {
            let finishedCheck = setInterval(async () => {
                if (this.successfulChunks === this.totalChunkAmount) {
                    clearInterval(finishedCheck);
                    try {
                        resolve(this.chunkBundle);
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    for (let chunk in this.failedChunks) {
                        let failedChunk = this.chunkBundle[this.failedChunks[chunk]];
                        if (!failedChunk["retrieved"]) {
                            this.retrieveChunk(failedChunk["hash"], this.failedChunks[chunk]);
                        }
                    }
                }
            }, 1234);
        });
    }

    async rebuildChunkTable(entryHash) {
        let chunkTable = {};
        let chunkTableFragments = [];

        let previousHash = entryHash;
        while (previousHash !== this.FirstChunkKeyword) {
            let chunkTableFragment;
            try {
                chunkTableFragment = await this.retrieveJSONFromTransaction(previousHash);
            } catch (err) {
                throw err;
            }
            chunkTableFragments.unshift(chunkTableFragment);
            previousHash = chunkTableFragment[this.PreviousHashKey];
        }

        for (let fragment in chunkTableFragments) {
            Object.keys(chunkTableFragments[fragment]).forEach(key => {
                if (key !== this.PreviousHashKey && key !== this.TotalChunkAmountKey) {
                    chunkTable[key] = chunkTableFragments[fragment][key];
                } else if (key === this.TotalChunkAmountKey) {
                    this.totalChunkAmount = chunkTableFragments[fragment][key];
                }
            });
        }

        return chunkTable;
    }

    async retrieveJSONFromTransaction(transactionHash) {
        try {
            let transactionBundle = await this.getTransactionFromTangle(transactionHash);
            return JSON.parse(this.iota.utils.extractJson(transactionBundle));
        } catch (err) {
            throw err;
        }
    }

    getTransactionFromTangle(transactionHash) {
        return new Promise((resolve, reject) => {
            this.iota.api.getBundle(transactionHash, (err, transactionBundle) => {
                if (err) {
                    switch (err.message) {
                        case 'Invalid inputs provided':
                            reject(new IncorrectTransactionHashError(err.message));
                            break;
                        case 'Invalid Bundle provided':
                            reject(new NodeOutdatedError(err.message));
                            break;
                        default:
                            reject(new Error(err.message));
                            break;
                    }
                }
                resolve(transactionBundle);
            });
        });
    }

    async persistChunkBundle() {
        for (let chunk in this.chunkBundle) {
            this.persistChunk(this.chunkBundle[chunk]);
        }

        try {
            return await this.finalizePersistingOfChunkBundle();
        } catch (err) {
            throw err;
        }
    }

    async persistChunk(chunk) {
        Marky.mark('saveToTangle');

        try {
            let failedChunkIndex = this.failedChunks.indexOf(chunk["index"]);
            if (failedChunkIndex !== -1) {
                this.failedChunks.splice(failedChunkIndex, 1);
            }

            let trytesMessage = this.iota.utils.toTrytes(JSON.stringify({[this.ChunkContentKey]: chunk["content"]}));
            let address = await this.getNewIotaAddress();
            let transaction = await this.sendTransaction(address, trytesMessage);

            Marky.stop('saveToTangle');

            chunk["hash"] = transaction["hash"];
            chunk["persisted"] = true;
            this.chunkBundle[chunk["index"]] = chunk;
            this.successfulChunks += 1;
            return true;
        } catch (err) {
            Marky.stop('saveToTangle');

            if (this.failedChunks.indexOf(chunk["index"]) === -1) {
                this.failedChunks.push(chunk["index"]);
            }

            console.error(err.message, chunk);
        }
    }

    async finalizePersistingOfChunkBundle() {
        return new Promise((resolve, reject) => {
            let finishedCheck = setInterval(async () => {
                if (this.successfulChunks === this.totalChunkAmount) {
                    clearInterval(finishedCheck);
                    try {
                        resolve(await this.finalizeChunkTable());
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    for (let chunk in this.failedChunks) {
                        let failedChunk = this.chunkBundle[this.failedChunks[chunk]];
                        if (!failedChunk["persisted"]) {
                            this.persistChunk(failedChunk);
                        }
                    }
                }
            }, 1234);
        });
    }

    async finalizeChunkTable() {
        let chunkTable = this.buildChunkTable();
        let chunkTableFragments = Tanglestash.chopIntoChunks(JSON.stringify(chunkTable), this.ChunkTableFragmentLength);
        try {
            return await this.persistChunkTable(chunkTableFragments);
        } catch (err) {
            throw err;
        }
    }

    buildChunkTable() {
        let chunkTable = {};
        for (let chunk in this.chunkBundle) {
            chunkTable[this.chunkBundle[chunk]["index"]] = this.chunkBundle[chunk]["hash"];
        }
        return chunkTable;
    }

    async persistChunkTable(chunkTableFragments) {
        try {
            let previousHash = this.FirstChunkKeyword;
            for (let fragment in chunkTableFragments) {
                fragment = JSON.parse(chunkTableFragments[fragment]);
                fragment[this.PreviousHashKey] = previousHash;
                fragment[this.TotalChunkAmountKey] = this.totalChunkAmount;

                let trytesMessage = this.iota.utils.toTrytes(JSON.stringify(fragment));
                let address = await this.getNewIotaAddress();
                let transaction = await this.sendTransaction(address, trytesMessage);

                previousHash = transaction["hash"];
            }
            return previousHash;
        } catch (err) {
            throw err;
        }
    }

    encodeData(data, secret) {
        let base64 = '';
        let datastring = '';

        switch (this.datatype) {
            case 'file':
                base64 = Tanglestash.parseFileIntoBase64(data);
                break;
            case 'string':
                base64 = Tanglestash.parseStringIntoBase64(data);
                break;
            default:
                throw new IncorrentDatatypeError('No correct "datatype" was passed');
        }

        if (secret) {
            datastring = Tanglestash.encrypt(base64, secret);
        } else {
            datastring = base64;
        }

        return datastring;
    }

    decodeData(data, secret) {
        let base64 = data;
        let result = '';

        if (secret) {
            base64 = Tanglestash.decrypt(base64, secret);
            if (!base64) {
                throw new IncorrectPasswordError('Provided secret incorrect');
            }
        }

        switch (this.datatype) {
            case 'file':
                result = Tanglestash.parseFileFromBase64(base64);
                break;
            case 'string':
                result = Tanglestash.parseStringFromBase64(base64);
                break;
            default:
                throw new IncorrentDatatypeError('No correct "datatype" was passed');
        }

        return result;
    }

    async retrievePotentialParentTransactions() {
        return new Promise((resolve, reject) => {
            this.iota.api.findTransactionObjects({"tags": [this.ChunkTag]}, (err, results) => {
                if (err) reject(err);
                resolve(results);
            });
        });
    }

    async sendTransaction(address, message) {
        try {
            let parentTransactions = this.getParentTransactions();
            let transferTrytes = await this.prepareTransferTrytes(address, message);
            let transactionTrytes = await this.attachToTangle(
                transferTrytes,
                parentTransactions.trunkTransaction,
                parentTransactions.branchTransaction,
            );
            return await this.broadcastTransaction(transactionTrytes);
        } catch (err) {
            throw err;
        }
    }

    getParentTransactions() {
        let randomParentTransactionsIndex = Tanglestash.drawRandomNumberBetween(0, (this.potentialParentTransactions.length - 1));
        let randomParentTransactions = this.potentialParentTransactions[randomParentTransactionsIndex];
        return ({
            branchTransaction: randomParentTransactions["hash"],
            trunkTransaction: randomParentTransactions["trunkTransaction"],
        });
    }

    async prepareTransferTrytes(address, message) {
        return new Promise((resolve, reject) => {
            this.iota.api.prepareTransfers(
                this.seed,
                [
                    {
                        'address': address,
                        'message': message,
                        'tag': this.ChunkTag,
                        'value': 0,
                    }
                ],
                (err, bundle) => {
                    if (err) {
                        if (err.message.includes('failed consistency check')) {
                            reject(new NodeOutdatedError(err.message));
                        } else {
                            reject(new Error(err.message));
                        }
                    }
                    resolve(bundle[0]);
                });
        });
    }

    attachToTangle(trytes, trunkTransaction, branchTransaction) {
        return new Promise((resolve, reject) => {
            Ccurl(
                trunkTransaction,
                branchTransaction,
                this.IotaTransactionMinWeightMagnitude,
                [trytes],
                (err, result) => {
                    if (err) reject(err);
                    resolve(result);
                }
            );
        });
    }

    broadcastTransaction(transactionTrytes) {
        return new Promise((resolve, reject) => {
            this.iota.api.storeAndBroadcast(transactionTrytes, (err, output) => {
                if (err) reject(err);
                resolve(this.iota.utils.transactionObject(transactionTrytes[0]));
            });
        });
    }

    /**
     * DEPRECATED
     */
    sendNewIotaTransaction(address, message) {
        return new Promise((resolve, reject) => {
            this.iota.api.sendTransfer(
                this.seed,
                this.IotaTransactionDepth,
                this.IotaTransactionMinWeightMagnitude,
                [
                    {
                        'address': address,
                        'message': message,
                        'tag': this.ChunkTag,
                        'value': 0,
                    }
                ],
                (err, bundle) => {
                    // TODO: Check why this sometimes doesn't reject correctly (if node is outdated)
                    if (err) {
                        if (err.message.includes('failed consistency check')) {
                            reject(new NodeOutdatedError(err.message));
                        } else {
                            reject(new Error(err.message));
                        }
                    }
                    resolve(bundle[0]);
                }
            );
        });
    }

    /**
     * Generates a random valid IOTA wallet seed.
     *
     * @returns {String} The generated seed
     */
    generateRandomIotaSeed() {
        return Randomstring.generate({
            length: this.IotaSeedLength,
            charset: this.IotaCharset,
        });
    }

    /**
     * Retrieves a new valid IOTA wallet address based on `this.seed`.
     *
     * @returns {Promise.<string>} The retrieved wallet address
     */
    getNewIotaAddress() {
        return new Promise((resolve, reject) => {
            this.iota.api.getNewAddress(this.seed, (err, address) => {
                if (err) reject(new Error(err.message));
                resolve(address);
            });
        });
    }

    /**
     * Returns all the `marky` entries used to time the main processes.
     *
     * @returns {Array.<object>} The array of the entries from `marky` entries
     */
    getAllMarkyEntries() {
        return Marky.getEntries();
    }

    static chopIntoChunks(datastring, chunkLength) {
        let regex = new RegExp(`.{1,${chunkLength}}`, 'g');
        return datastring.match(regex);
    }

    static generateChunkBundle(chunkContents) {
        let bundle = {};
        for (let chunkContent in chunkContents) {
            bundle[chunkContent] = Tanglestash.buildChunkBundleEntry(chunkContents[chunkContent], chunkContent);
        }
        return bundle;
    }

    static buildChunkBundleEntry(chunkContent, index) {
        return ({
            content: chunkContent,
            hash: null,
            index: index,
            persisted: false,
            retrieved: false,
        });
    }

    static parseFileIntoBase64(path) {
        let buffer = new Buffer(Fs.readFileSync(Path.resolve(path)));
        return buffer.toString('base64');
    }

    static parseStringIntoBase64(string) {
        return new Buffer(string).toString('base64');
    }

    static parseFileFromBase64(base64) {
        return new Buffer(base64, 'base64');
    }

    static parseStringFromBase64(base64) {
        return new Buffer(base64, 'base64').toString('utf-8');
    }

    static encrypt(plaintext, secret) {
        let ciphertext = CryptoJS.AES.encrypt(plaintext, secret);
        return ciphertext.toString();
    }

    static decrypt(ciphertext, secret) {
        let bytes = CryptoJS.AES.decrypt(ciphertext, secret);
        try {
            return bytes.toString(CryptoJS.enc.Utf8);
        } catch (err) {
            return false;
        }
    }

    static drawRandomNumberBetween(min, max) {
        return Math.floor(Math.random() * (max - min + 1) + min);
    }
}


/**
 * Custom Exceptions
 * **/

class IncorrectPasswordError extends Error {
    constructor(...args) {
        super(...args);
        this.name = IncorrectPasswordError.name;
    }
}

class IncorrentDatatypeError extends Error {
    constructor(...args) {
        super(...args);
        this.name = IncorrentDatatypeError.name;
    }
}

class IncorrectTransactionHashError extends Error {
    constructor(...args) {
        super(...args);
        this.name = IncorrectTransactionHashError.name;
    }
}

class NodeOutdatedError extends Error {
    constructor(...args) {
        super(...args);
        this.name = NodeOutdatedError.name;
    }
}


module.exports = {
    Tanglestash,
    IncorrectPasswordError,
    IncorrentDatatypeError,
    IncorrectTransactionHashError,
    NodeOutdatedError,
};
