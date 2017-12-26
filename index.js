const Fs = require("fs");
const Path = require("path");
const Randomstring = require('randomstring');
const CryptoJS = require("crypto-js");
const Iota = require("iota.lib.js");


class Tanglestash {
    /**
     * TANGLESTASH
     * **/

    constructor(provider, datatype, secret) {
        // CONSTANTS
        this.IotaSeedLength = 81;
        this.IotaCharset = '9ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        this.IotaTransactionExampleHash = '999999999999999999999999999999999999999999999999999999999999999999999999999999999';
        this.IotaTransactionSignatureMessageFragmentLength = 2187;
        this.ChunkPaddingLength = 9;
        this.ChunkScaffoldLength = JSON.stringify(Tanglestash.buildChunk('', 0, this.IotaTransactionExampleHash, 2)).length;
        this.ChunkContentLength = (this.IotaTransactionSignatureMessageFragmentLength - this.ChunkPaddingLength - this.ChunkScaffoldLength);
        this.firstChunkKeyword = '1st';

        // PROPERTIES
        this.iota = new Iota({'provider': provider, sandbox: true});  // Create IOTA instance utilizing the passed provider
        this.datatype = datatype || 'file';  // Set file as the default 'datatype' in case none was passed
        this.secret = secret || null;  // Set the secret to 'null' if the user does not want to use encryption
        this.seed = this.generateRandomIotaSeed();
    }

    readFromTangle(entryHash) {
        let nextHash = entryHash;
        while (nextHash !== this.firstChunkKeyword) {
            // TODO: Implement read-out from the Tangle
            nextHash = 'nextHash';
        }
    }

    saveToTangle(data) {
        let datastring = this.prepareData(data);
        let chunksContents = this.createChunkContents(datastring);
        let totalChunkAmount = parseInt(chunksContents.length);

        let previousChunkHash = this.firstChunkKeyword;
        for (let chunkContent in chunksContents) {
            let chunk = Tanglestash.buildChunk(
                chunksContents[chunkContent],
                parseInt(chunkContent),
                previousChunkHash,
                totalChunkAmount
            );

            let trytesMessage = this.iota.utils.toTrytes(JSON.stringify(chunk));
        }
        let startChunkHash = previousChunkHash;
    }

    prepareData(data) {
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

    decryptData(data) {
        let base64 = Tanglestash.decrypt(data, this.secret);

        switch (this.datatype) {
            case 'file':
                return Tanglestash.parseFileFromBase64(base64);
                break;
            case 'string':
                return Tanglestash.parseStringFromBase64(base64);
                break;
            default:
                // TODO: Throw error
                console.error('No correct "datatype" was passed!');
        }
    }

    generateRandomIotaSeed() {
        return Randomstring.generate({
            length: this.IotaSeedLength,
            charset: this.IotaCharset,
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

    static parseFileFromBase64(base64) {
        return new Buffer(base64, 'base64');
    }

    static parseStringFromBase64(base64) {
        return new Buffer(base64, 'base64').toString('utf-8')
    }

    static encrypt(plaintext, secret) {
        let ciphertext = CryptoJS.AES.encrypt(plaintext, secret);
        return ciphertext.toString();
    }

    static decrypt(ciphertext, secret) {
        let bytes = CryptoJS.AES.decrypt(ciphertext, secret);
        return bytes.toString(CryptoJS.enc.Utf8);
    }
}

module.exports = Tanglestash;
