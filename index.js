const Fs = require("fs");
const Path = require("path");
const Randomstring = require("randomstring");
const CryptoJS = require("crypto-js");
const Iota = require("iota.lib.js");


class Tanglestash {
    /**
     * TANGLESTASH
     * **/

    constructor(provider, datatype, secret) {
        // CONSTANTS
        this.IotaTransactionDepth = 4;
        this.IotaTransactionMinWeightMagnitude = 14;
        this.IotaSeedLength = 81;
        this.IotaCharset = '9ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        this.IotaTransactionExampleHash = '999999999999999999999999999999999999999999999999999999999999999999999999999999999';
        this.IotaTransactionSignatureMessageFragmentLength = 2187;
        this.ChunkPaddingLength = 9;
        this.ChunkScaffoldLength = JSON.stringify(Tanglestash.buildChunk('', 0, this.IotaTransactionExampleHash, 2)).length;
        this.ChunkContentLength = (this.IotaTransactionSignatureMessageFragmentLength - this.ChunkPaddingLength - this.ChunkScaffoldLength);
        this.ChunkTag = 'TANGLESTASH9999999999999999';
        this.FirstChunkKeyword = '1st';

        // PROPERTIES
        this.iota = new Iota({'provider': provider});  // Create IOTA instance utilizing the passed provider
        this.datatype = datatype || 'file';  // Set file as the default 'datatype' in case none was passed
        this.secret = secret || null;  // Set the secret to 'null' if the user does not want to use encryption
        this.seed = this.generateRandomIotaSeed();  // Generate a fresh and random IOTA seed
    }

    async saveToTangle(data) {
        let datastring = this.encodeData(data);
        let chunkContents = this.createChunkContents(datastring);
        let totalChunkAmount = parseInt(chunkContents.length);
        this.currentChunkPosition = 1;
        this.totalChunkAmount = totalChunkAmount;

        let previousChunkHash = this.FirstChunkKeyword;
        for (let chunkContent in chunkContents) {
            console.log(this.currentChunkPosition, this.totalChunkAmount);
            let chunk = Tanglestash.buildChunk(
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
        }
        console.log(previousChunkHash);
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
                // TODO: Throw error
                console.error('No correct "datatype" was passed!');
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
        }

        switch (this.datatype) {
            case 'file':
                result = Tanglestash.parseFileFromBase64(base64, path);
                break;
            case 'string':
                result = Tanglestash.parseStringFromBase64(base64);
                break;
            default:
                // TODO: Throw error
                console.error('No correct "datatype" was passed!');
        }

        return result;
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

    static buildChunk(chunkContent, indexChunk, previousChunkHash, totalChunksAmount) {
        return (
            {
                "cC": chunkContent,
                "iC": indexChunk,
                "pC": previousChunkHash,
                "tC": totalChunksAmount
            }
        );
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
        return Fs.writeFileSync(Path.resolve(path), buffer);
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
            // TODO: Throw proper error
            console.error('The data could not be decrypted; the secret might be wrong!');
            throw err;
        }
    }
}

module.exports = Tanglestash;
