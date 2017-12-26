const Fs = require("fs");
const Path = require("path");
const Iota = require("iota.lib.js");
const CryptoJS = require("crypto-js");


class Tanglestash {
    /**
     * TANGLESTASH
     * **/

    constructor(data, datatype, secret) {
        // CONSTANTS
        this.IotaTransactionSignatureMessageFragmentLength = 2187;
        this.ChunkPaddingLength = 9;
        this.ChunkScaffoldLength = JSON.stringify(Tanglestash.buildChunkScaffold('', 1, 1)).length;
        this.ChunkContentLength = (this.IotaTransactionSignatureMessageFragmentLength - this.ChunkPaddingLength - this.ChunkScaffoldLength);

        // PROPERTIES
        this.data = data;
        this.datatype = datatype || 'file';  // Set file as the default 'datatype' in case none was passed
        this.secret = secret || null;  // Set the secret to 'null' if the user does not want to use encryption
    }

    persistToTangle() {

    }

    createChunks(data) {

    }

    static buildChunkScaffold(chunkContent, totalChunksAmount, presentChunkPosition) {
        return (
            {
                "cC": chunkContent,
                "pC": presentChunkPosition,
                "tC": totalChunksAmount
            }
        );
    }

    static encryptData(data) {
        let base64 = '';

        switch (this.datatype) {
            case 'file':
                base64 = Tanglestash.parseFileIntoBase64(data);
                break;
            case 'string':
                base64 = Tanglestash.parseStringIntoBase64(data);
                break;
            default:
            // TODO: Throw error
        }

        return Tanglestash.encrypt(base64, this.secret);
    }

    static decryptData(data) {
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
        }
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
