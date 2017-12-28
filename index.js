const Fs = require("fs");
const Path = require("path");
const Randomstring = require("randomstring");
const CryptoJS = require("crypto-js");
const Marky = require("marky");
const Iota = require("iota.lib.js");


/**
 * TANGLESTASH
 * An algorithm to persist any file onto the DAG of IOTA
 * By Jakob Löhnertz (www.jakob.codes)
 * **/

class Tanglestash {
    constructor(provider, datatype) {
        // CONSTANTS
        this.ChunkShortKeys = {
            "content": "cC",
            "index": "iC",
            "previousHash": "pC",
            "totalAmount": "tC",
        };
        this.IotaTransactionDepth = 4;
        this.IotaTransactionMinWeightMagnitude = 14;
        this.IotaSeedLength = 81;
        this.IotaCharset = '9ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        this.IotaTransactionExampleHash = '999999999999999999999999999999999999999999999999999999999999999999999999999999999';
        this.IotaTransactionSignatureMessageFragmentLength = 2187;
        this.ChunkPaddingLength = 9;
        this.ChunkScaffoldLength = JSON.stringify(this.buildChunk('', 0, this.IotaTransactionExampleHash, 2)).length;
        this.ChunkContentLength = (this.IotaTransactionSignatureMessageFragmentLength - this.ChunkPaddingLength - this.ChunkScaffoldLength);
        this.ChunkTag = 'TANGLESTASH9999999999999999';
        this.FirstChunkKeyword = '1st';

        // PROPERTIES
        this.iota = new Iota({'provider': provider});  // Create IOTA instance utilizing the passed provider
        this.datatype = datatype || 'file';  // Set file as the default 'datatype' in case none was passed
        this.seed = this.generateRandomIotaSeed();  // Generate a fresh and random IOTA seed
        this.currentChunkPosition = 0;
        this.totalChunkAmount = 0;
    }

    /**
     * Retrieves data that was persisted to the Tangle in the past.
     *
     * @param {String} entryHash The entry-hash to start the retrieval (return value from `saveToTangle()`)
     * @param {String} secret [Optional] A secret to decrypt the data if it was persisted with encryption beforehand
     * @param {String} path [Optional] The path to save the returned file to
     * @returns {Promise.<*>} A file or a string based on `this.datatype`
     */
    async readFromTangle(entryHash, secret, path) {
        let chunkContents = [];

        let previousHash = entryHash;
        while (previousHash !== this.FirstChunkKeyword) {
            Marky.mark('readFromTangle');
            try {
                let transactionBundle = await this.getTransactionFromTangle(previousHash);
                let chunk = JSON.parse(this.iota.utils.extractJson(transactionBundle));
                chunkContents.unshift(chunk[this.ChunkShortKeys["content"]]);
                previousHash = chunk[this.ChunkShortKeys["previousHash"]];
                this.currentChunkPosition = (parseInt(chunk[this.ChunkShortKeys["index"]]) + 1);
                this.totalChunkAmount = parseInt(chunk[this.ChunkShortKeys["totalAmount"]]);
            } catch (err) {
                throw err;
            }
            Marky.stop('readFromTangle');
        }

        let datastringBase64 = chunkContents.join('');
        try {
            return this.decodeData(datastringBase64, secret, path);
        } catch (err) {
            throw err;
        }
    }

    /**
     * Persists data to the Tangle.
     *
     * @param {String} data The data as a file path or a string based on `this.datatype`
     * @param {String} secret [Optional] A secret to encrypt the data
     * @returns {Promise.<string>} The entry-hash for this persisted data
     */
    async saveToTangle(data, secret) {
        let datastring = '';
        let chunkContents = [];

        try {
            datastring = this.encodeData(data, secret);
            chunkContents = this.createChunkContents(datastring);
        } catch (err) {
            throw err;
        }

        let totalChunkAmount = parseInt(chunkContents.length);
        this.currentChunkPosition = 1;
        this.totalChunkAmount = totalChunkAmount;

        let previousChunkHash = this.FirstChunkKeyword;
        for (let chunkContent in chunkContents) {
            Marky.mark('saveToTangle');
            let chunk = this.buildChunk(
                chunkContents[chunkContent],
                parseInt(chunkContent),
                previousChunkHash,
                totalChunkAmount
            );
            let trytesMessage = this.iota.utils.toTrytes(JSON.stringify(chunk));
            try {
                let address = await this.getNewIotaAddress();
                let transaction = await this.sendNewIotaTransaction(address, trytesMessage);
                previousChunkHash = transaction["hash"];
            } catch (err) {
                throw err;
            }
            this.currentChunkPosition += 1;
            Marky.stop('saveToTangle');
        }

        return previousChunkHash;
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

    decodeData(data, secret, path) {
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
                result = Tanglestash.parseFileFromBase64(base64, path);
                break;
            case 'string':
                result = Tanglestash.parseStringFromBase64(base64);
                break;
            default:
                throw new IncorrentDatatypeError('No correct "datatype" was passed');
        }

        return result;
    }

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
     * Generates a new valid IOTA seed.
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
     * Retrieves a new valid IOTA wallet address.
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

    createChunkContents(datastring) {
        let regex = new RegExp(`.{1,${this.ChunkContentLength}}`, 'g');
        return datastring.match(regex);
    }

    buildChunk(chunkContent, indexChunk, previousChunkHash, totalChunksAmount) {
        return (
            {
                [this.ChunkShortKeys["content"]]: chunkContent,
                [this.ChunkShortKeys["index"]]: indexChunk,
                [this.ChunkShortKeys["previousHash"]]: previousChunkHash,
                [this.ChunkShortKeys["totalAmount"]]: totalChunksAmount
            }
        );
    }

    /**
     * Returns all the 'marky' timings
     *
     * @returns {Array.<object>} The array of the entries from 'marky' timings
     */
    getAllMarkyEntries() {
        return Marky.getEntries();
    }

    static parseFileIntoBase64(path) {
        let buffer = new Buffer(Fs.readFileSync(Path.resolve(path)));
        return buffer.toString('base64');
    }

    static parseStringIntoBase64(string) {
        return new Buffer(string).toString('base64');
    }

    static parseFileFromBase64(base64, path) {
        let buffer = new Buffer(base64, 'base64');
        try {
            Fs.writeFileSync(Path.resolve(path), buffer);
            return true;
        } catch (err) {
            throw err;
        }
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
