const Fs = require("fs");
const Path = require("path");
const Randomstring = require("randomstring");
const CryptoJS = require("crypto-js");
const Marky = require("marky");
const Iota = require("iota.lib.js");


class Tanglestash {
    /**
     * TANGLESTASH
     * An algorithm to persist any file onto the DAG of IOTA
     * By Jakob Löhnertz (www.jakob.codes)
     * **/

    constructor(provider, datatype, secret) {
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
        this.secret = secret || null;  // Set the secret to 'null' if the user does not want to use encryption
        this.seed = this.generateRandomIotaSeed();  // Generate a fresh and random IOTA seed
        this.currentChunkPosition = 0;
        this.totalChunkAmount = 0;
    }

    async readFromTangle(entryHash, path) {
        let chunkContents = [];

        let previousHash = entryHash;
        while (previousHash !== this.FirstChunkKeyword) {
            Marky.mark('readFromTangle');
            let transactionBundle = await this.getTransactionFromTangle(previousHash);
            let chunk = JSON.parse(this.iota.utils.extractJson(transactionBundle));
            try {
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
            return this.decodeData(datastringBase64, path);
        } catch (err) {
            return err.name;
        }
    }

    async saveToTangle(data) {
        try {
            let datastring = this.encodeData(data);
            let chunkContents = this.createChunkContents(datastring);
            let totalChunkAmount = parseInt(chunkContents.length);
        } catch (err) {
            return err.name;
        }

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
            let address = await this.getNewIotaAddress();
            let transaction = await this.sendNewIotaTransaction(address, trytesMessage);
            previousChunkHash = transaction["hash"];
            this.currentChunkPosition += 1;
            Marky.stop('saveToTangle');
        }

        return previousChunkHash;
    }

    getTransactionFromTangle(transactionHash) {
        return new Promise((resolve, reject) => {
            this.iota.api.getBundle(transactionHash, (err, transactionBundle) => {
                if (err) throw err;
                resolve(transactionBundle);
            });
        });
    }

    encodeData(data) {
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
                console.error('No correct "datatype" was passed!');
                throw new IncorrentDatatype();
        }

        if (this.secret) {
            datastring = Tanglestash.encrypt(base64, this.secret);
        } else {
            datastring = base64;
        }

        return datastring;
    }

    decodeData(data, path) {
        let base64 = data;
        let result = '';

        if (this.secret) {
            base64 = Tanglestash.decrypt(base64, this.secret);
            if (!base64) {
                throw new PasswordError();
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
                console.error('No correct "datatype" was passed!');
                throw new IncorrentDatatype();
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
                    if (err) throw err;
                    resolve(bundle[0]);
                }
            );
        });
    }

    generateRandomIotaSeed() {
        return Randomstring.generate({
            length: this.IotaSeedLength,
            charset: this.IotaCharset,
        });
    }

    getNewIotaAddress() {
        return new Promise((resolve, reject) => {
            this.iota.api.getNewAddress(this.seed, (err, address) => {
                if (err) throw err;
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
            console.error('The data could not be decrypted; the secret might be wrong!');
            return false;
        }
    }
}

class PasswordError extends Error {
    constructor(...args) {
        super(...args);
        this.name = PasswordError.name;
    }
}

class IncorrentDatatype extends Error {
    constructor(...args) {
        super(...args);
        this.name = IncorrentDatatype.name;
    }
}

module.exports = {Tanglestash, PasswordError, IncorrentDatatype};
