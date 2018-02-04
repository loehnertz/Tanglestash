const Path = require('path');

const Marky = require('marky');
const Iota = require('iota.lib.js');

const TanglestashCustomErrors = require('./tanglestash-errors');
const TanglestashHelpers = require('./tanglestash-helpers');
const CcurlInterface = require('./ccurl-interface');


/**
 * TANGLESTASH
 * IOTA meets BitTorrent: An algorithm to persist any file onto the tangle of IOTA
 * By Jakob Löhnertz (www.jakob.codes)
 **/

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
        this.libccurl = CcurlInterface.prepareCcurlProvider(Path.resolve('./lib/libccurl'));  // Creates an instance of libccurl to perform the PoW
        this.datatype = datatype || 'file';  // Set file as the default 'datatype' in case none was passed
        this.seed = seed || TanglestashHelpers.generateRandomIotaSeed();  // Generate a fresh and random IOTA seed
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

        this.successfulChunks = 0;
        this.totalChunkAmount = parseInt(Object.keys(this.chunkBundle).length);

        try {
            return await this.persistChunkBundle();
        } catch (err) {
            throw err;
        }
    }

    /**
     * Retrieves the single chunks after the Chunk Table got rebuilt.
     * Also kicks off the method that checks for the state of the retrieval and retries single chunks if needed.
     */
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

    /**
     * Retrieves a single chunk via its transaction hash.
     * In case it fails the index of the chunk will be added to `this.failedChunks` for a later retry.
     */
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

            console.warn(err.message, transactionHash, index);
        }
    }

    /**
     * Checks for the state of the retrieval and retries single chunks if needed.
     */
    finalizeRetrievalOfChunkBundle() {
        return new Promise((resolve, reject) => {
            let finishedCheck = setInterval(() => {
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

    /**
     * Rebuilds the Chunk Table with the initial Entry Hash.
     */
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

    /**
     * Retrieves JSON from a transaction.
     */
    async retrieveJSONFromTransaction(transactionHash) {
        try {
            let transactionBundle = await this.getTransactionFromTangle(transactionHash);
            return JSON.parse(this.iota.utils.extractJson(transactionBundle));
        } catch (err) {
            throw err;
        }
    }

    /**
     * Actual retrieval of a transaction.
     */
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

    /**
     * Loops over all the chunks and awaits their success by waiting for the returned transaction hash.
     * Also kicks off the method that checks for the state of the persisting and retries single chunks if needed.
     */
    async persistChunkBundle() {
        for (let chunk in this.chunkBundle) {
            await this.persistChunk(this.chunkBundle[chunk]);
        }

        try {
            return await this.finalizePersistingOfChunkBundle();
        } catch (err) {
            throw err;
        }
    }

    /**
     * Persists a single chunk.
     * In case it fails the index of the chunk will be added to `this.failedChunks` for a later retry.
     */
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

            console.warn(err.message, chunk);
        }
    }

    /**
     * Checks for the state of the persisting and retries single chunks if needed.
     * Kicks off the persisting of the Chunk Table once every chunk containing content is successfully persisted.
     */
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
                            await this.persistChunk(failedChunk);
                        }
                    }
                }
            }, 1234);
        });
    }

    /**
     * Constructs the Chunk Table, chops it up and starts to persist it.
     */
    async finalizeChunkTable() {
        let chunkTable = this.buildChunkTable();
        let chunkTableFragments = this.chopChunkTable(chunkTable, this.ChunkTableHashAmount);
        try {
            return await this.persistChunkTable(chunkTableFragments);
        } catch (err) {
            throw err;
        }
    }

    /**
     * Generates the Chunk Table.
     */
    buildChunkTable() {
        let chunkTable = {};
        for (let chunk in this.chunkBundle) {
            chunkTable[this.chunkBundle[chunk]["index"]] = this.chunkBundle[chunk]["hash"];
        }
        return chunkTable;
    }

    /**
     * Persists the Chunk Table fragments onto the tangle.
     */
    async persistChunkTable(chunkTableFragments) {
        let previousHash = this.FirstChunkKeyword;
        for (let fragment in chunkTableFragments) {
            chunkTableFragments[fragment][this.PreviousHashKey] = previousHash;
            chunkTableFragments[fragment][this.TotalChunkAmountKey] = this.totalChunkAmount;

            let trytesMessage = this.iota.utils.toTrytes(JSON.stringify(chunkTableFragments[fragment]));
            let address = await this.getNewIotaAddress();

            let transaction = null;
            while (!transaction) {
                transaction = await this.sendTransaction(address, trytesMessage);
            }

            previousHash = transaction["hash"];
        }
        return previousHash;
    }

    /**
     * Dispatches all the needed steps to send a new transaction.
     */
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

    /**
     * Retrieves a `trunkTransaction` as well as a `branchTransaction` via the node for a new transaction.
     */
    getParentTransactions() {
        return new Promise((resolve, reject) => {
            this.iota.api.getTransactionsToApprove(this.IotaTransactionDepth, null, (err, transactions) => {
                if (err) reject(err);
                if (!transactions) reject(new TanglestashCustomErrors.NodeCouldNotProvideTransactionsToApproveError());
                resolve({
                    trunkTransaction: transactions.trunkTransaction,
                    branchTransaction: transactions.branchTransaction,
                });
            });
        });
    }

    /**
     * Prepares a transaction for the PoW.
     */
    prepareTransferTrytes(address, message) {
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

    /**
     * Launches `ccurl` to perform the PoW on the passed transaction trytes.
     */
    attachToTangle(trytes, trunkTransaction, branchTransaction) {
        return new Promise((resolve, reject) => {
            new CcurlInterface(
                trunkTransaction,
                branchTransaction,
                trytes,
                this.IotaTransactionMinWeightMagnitude,
                this.iota,
                this.libccurl
            ).performPoW().then((result) => {
                resolve(result);
            }).catch((err) => {
                reject(err);
            });
        });
    }

    /**
     * Broadcasts a processed transaction onto the tangle via the node.
     */
    broadcastTransaction(transactionTrytes) {
        return new Promise((resolve, reject) => {
            this.iota.api.storeAndBroadcast(transactionTrytes, (err, output) => {
                if (err) reject(err);
                resolve(this.iota.utils.transactionObject(transactionTrytes[0]));
            });
        });
    }

    /**
     * Encodes passed data into Base64.
     * Optionally encrypts the data with a passed secret.
     */
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
                throw new TanglestashCustomErrors.IncorrectDatatypeError('No valid "datatype" was passed');
        }

        if (secret) {
            datastring = TanglestashHelpers.encrypt(base64, secret);
        } else {
            datastring = base64;
        }

        return datastring;
    }

    /**
     * Decodes passed data into a buffer/string.
     * Might decrypt the data if a secret is passed.
     */
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
                throw new TanglestashCustomErrors.IncorrectDatatypeError('No valid "datatype" was passed');
        }

        return result;
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

    /**
     * Chops the Chunk Table into fragments respectively chunks as well to fit it into multiple transactions.
     */
    chopChunkTable(chunkTable, hashesPerChunk) {
        let chunkIndex = -1;
        let chunkTableChunks = [];
        Object.keys(chunkTable).forEach((key, index) => {
            if (index == 0 || index % hashesPerChunk === 0) {
                chunkTableChunks.push({});
                chunkIndex++;
            }
            chunkTableChunks[chunkIndex][key] = chunkTable[key];
        });
        return chunkTableChunks;
    }

    /**
     * Chops up data into a passed chunk length.
     */
    static chopIntoChunks(datastring, chunkLength) {
        let regex = new RegExp(`.{1,${chunkLength}}`, 'g');
        return datastring.match(regex);
    }

    /**
     * Constructs the bundle of all the chunks containing the content.
     */
    static generateChunkBundle(chunkContents) {
        let bundle = {};
        for (let chunkContent in chunkContents) {
            bundle[chunkContent] = Tanglestash.buildChunkBundleEntry(chunkContents[chunkContent], chunkContent);
        }
        return bundle;
    }

    /**
     * Generates an entry of a bundle of chunks.
     */
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
