const Path = require("path");

const Randomstring = require("randomstring");
const Marky = require("marky");
const Iota = require("iota.lib.js");

const TanglestashCustomErrors = require('./app/custom-errors');
const TanglestashHelpers = require('./app/helpers');
const CcurlInterface = require("./app/ccurl-interface");


/**
 * TANGLESTASH
 * IOTA meets BitTorrent: An algorithm to persist any file onto the tangle of IOTA
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
        this.IotaTransactionDepth = 3;
        this.IotaTransactionMinWeightMagnitude = 14;
        this.IotaSeedLength = 81;
        this.IotaCharset = '9ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        this.IotaTransactionSignatureMessageFragmentLength = 2187;
        this.ChunkPaddingLength = 19;
        this.ChunkTablePreviousHashLength = 109;
        this.ChunkContentLength = (this.IotaTransactionSignatureMessageFragmentLength - this.ChunkPaddingLength);
        this.ChunkTableHashAmount = parseInt(this.ChunkContentLength / this.ChunkTablePreviousHashLength) - 1;
        this.ChunkTag = 'TANGLESTASH9999999999999999';
        this.ChunkContentKey = 'CC';
        this.TotalChunkAmountKey = 'TC';
        this.PreviousHashKey = 'PCTFH';
        this.FirstChunkKeyword = '1st';

        // PROPERTIES
        this.iota = new Iota({'provider': provider});  // Create IOTA instance utilizing the passed provider
        this.libccurl = CcurlInterface.prepareCcurlProvider(Path.resolve('./lib/libccurl'));
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
                            reject(new TanglestashCustomErrors.IncorrectTransactionHashError(err.message));
                            break;
                        case 'Invalid Bundle provided':
                            reject(new TanglestashCustomErrors.NodeOutdatedError(err.message));
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
            console.log(this.successfulChunks, this.totalChunkAmount, this.failedChunks);
            await this.persistChunk(this.chunkBundle[chunk]);
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
                    console.log(this.successfulChunks, this.totalChunkAmount, this.failedChunks);
                    for (let chunk in this.failedChunks) {
                        let failedChunk = this.chunkBundle[this.failedChunks[chunk]];
                        if (!failedChunk["persisted"]) {
                            await this.persistChunk(failedChunk);
                        }
                    }
                }
            }, 1234);
        });
    }

    async finalizeChunkTable() {
        let chunkTable = this.buildChunkTable();
        let chunkTableFragments = this.chopChunkTable(chunkTable, this.ChunkTableHashAmount);
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
                chunkTableFragments[fragment][this.PreviousHashKey] = previousHash;
                chunkTableFragments[fragment][this.TotalChunkAmountKey] = this.totalChunkAmount;

                let trytesMessage = this.iota.utils.toTrytes(JSON.stringify(chunkTableFragments[fragment]));
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
                base64 = TanglestashHelpers.parseFileIntoBase64(data);
                break;
            case 'string':
                base64 = TanglestashHelpers.parseStringIntoBase64(data);
                break;
            default:
                throw new TanglestashCustomErrors.IncorrentDatatypeError('No correct "datatype" was passed');
        }

        if (secret) {
            datastring = TanglestashHelpers.encrypt(base64, secret);
        } else {
            datastring = base64;
        }

        return datastring;
    }

    decodeData(data, secret) {
        let base64 = data;
        let result = '';

        if (secret) {
            base64 = TanglestashHelpers.decrypt(base64, secret);
            if (!base64) {
                throw new TanglestashCustomErrors.IncorrectPasswordError('Provided secret incorrect');
            }
        }

        switch (this.datatype) {
            case 'file':
                result = TanglestashHelpers.parseFileFromBase64(base64);
                break;
            case 'string':
                result = TanglestashHelpers.parseStringFromBase64(base64);
                break;
            default:
                throw new TanglestashCustomErrors.IncorrentDatatypeError('No correct "datatype" was passed');
        }

        return result;
    }

    async sendTransaction(address, message) {
        try {
            let parentTransactions = await this.getParentTransactions();
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

    async getParentTransactions() {
        return new Promise((resolve, reject) => {
            this.iota.api.getTransactionsToApprove(this.IotaTransactionDepth, null, (err, transactions) => {
                if (err || !transactions) reject(err);
                resolve({
                    trunkTransaction: transactions.trunkTransaction,
                    branchTransaction: transactions.branchTransaction,
                });
            });
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
                    if (err || !bundle) {
                        if (err.message.includes('failed consistency check')) {
                            reject(new TanglestashCustomErrors.NodeOutdatedError(err.message));
                        } else {
                            reject(new Error(err.message || 'No correct bundle was returned'));
                        }
                    }
                    resolve(bundle);
                });
        });
    }

    attachToTangle(trytes, trunkTransaction, branchTransaction) {
        return new Promise((resolve, reject) => {
            new CcurlInterface(
                trunkTransaction,
                branchTransaction,
                this.IotaTransactionMinWeightMagnitude,
                trytes,
                this.iota,
                this.libccurl
            ).hash().then((result) => {
                resolve(result);
            }).catch((err) => {
                reject(err);
            });
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
                            reject(new TanglestashCustomErrors.NodeOutdatedError(err.message));
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
}


module.exports = Tanglestash;
