/**
 * OSS 大文件断点上传multipleUploader
 *
 */
import 'babel-polyfill';
import SparkMD5 from 'spark-md5';

console.log(SparkMD5)

const STATE = {
    'START': 0,
    'STOP': 1,
    'UPLOADING': 2,
    'ABORT': 3,
    'FINISH': 4
}

const ERROR_CODE = {
    'InvalidAccessKeyIdError': 403,
    'Parse': 100
}

function OSSUploader(options) {

    this.options = {
        maxSize: '1024', //单位MB
        chunkSize: '20',
        progress: options.progress,
        complete: options.complete,
        error: options.error,
        dir: options.dir || '',
        upload_button: options.upload_button || null,
        container: options.container || null,
        partSize: options.partSize || 10
    }

    //上传状态    
    this.state = STATE['STOP'];

    //文件状态
    this.fileState = {
        file: null,
        name: null,
        uploadName: null,
        fileSize: null,
        partSize: null,
        numParts: 0,
        //uploadId
        uploadId: null,

        //上传成功parts
        doneParts: [],

        //文件分块存储
        multipartList: []
    }

    this.checkpoint = {};

    //认证信息
    this.validParams = {};

    //client对象
    this.client = null;


    this.initValidParams(options);
    this.init();
    this.initCSS();

}

OSSUploader.prototype.init = function () {
    this.client = new OSS.Wrapper(this.validParams);
}

OSSUploader.prototype.initValidParams = function (options) {

    // if (!options.token) {

    //     console.warn('缺少token');

    //     return;
    // }

    // this.validParams = {
    //     region: options.token.get ?  options.token.get('region') : options.token.region,
    //     accessKeyId: options.token.get ?  options.token.get('accessKeyId') : options.token.accessKeyId,
    //     accessKeySecret: options.token.get ?  options.token.get('accessKeySecret') : options.token.accessKeySecret,
    //     stsToken: options.token.get ? options.token.get('stsToken') : options.token.stsToken,
    //     bucket: options.token.get ?  options.token.get('bucket') : options.token.bucket,
    // }

    this.validParams = {
        region: "oss-cn-shenzhen",
        accessKeyId: 'STS.LqFGdWKaBPJmXY3x7kdn4ZB6N',
        accessKeySecret: "Eb84DWKdCDhRDofxUs8V77TrjnCVfu1my1CKpua8XG7u",
        stsToken: 'CAIS/wF1q6Ft5B2yfSjIrbLzDN7jpr5j54iGWn+CnDc+aOEYtYedrDz2IHpLdHVhBeAftPowmmpR7/sblqJ4T55IQ1Dza8J148z4GLceqMmT1fau5Jko1beHewHKeTOZsebWZ+LmNqC/Ht6md1HDkAJq3LL+bk/Mdle5MJqP+/UFB5ZtKWveVzddA8pMLQZPsdITMWCrVcygKRn3mGHdfiEK00he8Tolsv7jnJ3NskqE1g2hkL8vyt6vcsT+Xa5FJ4xiVtq55utye5fa3TRYgxowr/0p3PAVpWee5I/CXQMIukjfKZfd9tx+MQl+fbMnA6pDpfT1nvZ1offDFxF9GLa4zYsagAGf7m5tgnGuqlaquMJXcwiyplz7hsBtUS1D0uVRpU9GQ29Wgoo2A9DYsAgYOL+5Ibv5q2A44qHzq4pz4c00rLXv4FuDMoKPkYhWTMhgvWi88p6EYZlrQyboRt8TW5zwdVTyJlSuHsxPk0+OkddFfjZIImbBdytX51SuleFg2sKHEQ==',
        bucket: "dev-pvideo-touchtv"
    }



}

OSSUploader.prototype.initCSS = function () {

    if (!this.options.upload_button || !this.options.container) {

        console.warn('缺少上传按钮id和父元素id')

        return;

    }

    const { upload_button, container } = this.options;

    document.getElementById(container).style.position = 'relative';

    const uploadButtonStyle = {
        position: 'absolute',
        top: 0,
        left: 0,
        overflow: 'hidden',
        'z-index': 0,
        opacity: 0,
        cursor: 'pointer'
    }    

    var styles = Object.keys(uploadButtonStyle);
    
    styles.map(item => {
        document.getElementById(upload_button).style[item] = uploadButtonStyle[item];
    });

    document.getElementById(upload_button).style.width = document.getElementById('videoUpload-button').offsetWidth + 'px';
    document.getElementById(upload_button).style.height = document.getElementById('videoUpload-button').offsetHeight + 'px';

}


/**
 * 初始化分片上传，获得uploadId
 */
OSSUploader.prototype.initMultipartUpload = async function () {

    const { uploadName } = this.fileState;

    // if (localStorage[uploadName]) {
    //     return this.fileState.uploadId = localStorage[uploadName];
    // }

    const res = await this.client._initMultipartUpload(uploadName);

    this.fileState.uploadId = res.uploadId;

    localStorage[uploadName] = res.uploadId;

    return res;

}


/**
 * 初始化file
 */
OSSUploader.prototype.initFileState = function (file) {

    this.fileState.file = file;
    this.fileState.fileSize = file.size;
    this.fileState.name = file.name;
    this.fileState.partSize = 10 * 1024 * 1024;

    //md5
    var sparkMd5 = new SparkMD5();

    //分块    
    var partOffs = this.client._divideParts(file.size, this.fileState.partSize);

    var numParts = partOffs.length;

    this.fileState.numParts = numParts;


    for (var i = 0; i < numParts; i++) {
        var pi = partOffs[i];
        var data = {
            stream: this.client._createStream(file, pi.start, pi.end),
            size: pi.end - pi.start,
            status: 0
        };

        sparkMd5.appendBinary(data.stream.file);

        this.fileState.multipartList.push(data);
    }


    this.md5 = sparkMd5.end();

    this.fileState.uploadName = this.createName(file.name, 16);

    console.log(this.fileState.multipartList)

}

/**
 * 逐片上传
 */
OSSUploader.prototype.uploadPart = async function uploadPart(name, uploadId, partNo, data) { 

    if (this.state == STATE['STOP'] || this.state == STATE['ABORT']) {
        return await Promise.reject('state: ' + this.state)
    }

    const res = await this.client._uploadPart(name, uploadId, partNo, data);

    if (this.state == STATE['STOP'] || this.state == STATE['ABORT']) {
        return await Promise.reject('state: ' + this.state)
    }

    this.fileState.doneParts.push({
        number: partNo,
        etag: res.etag
    });

    console.log(this.fileState.doneParts.length / this.fileState.numParts)

    if (this.options.progress) {

        this.options.progress(this.fileState.doneParts.length / this.fileState.numParts, this.fileState);
    }

    return res;

}

/**
 * 启动上传
 */
OSSUploader.prototype.multipartUpload = async function multipartUpload() {

    const { uploadId, uploadName } = this.fileState;

    let len = this.fileState.multipartList.length;

        for (let i = 0; i < len; i++) {
            if (!this.fileState.multipartList[i].status) {
                await this.uploadPart(uploadName, uploadId, i + 1, this.fileState.multipartList[i]);
            }
        }
    
   
}

/**
 * 完成上传，通知服务器合并
 */
OSSUploader.prototype.completeMultipartUpload = async function completeMultipartUpload() {

    if (this.state == STATE['STOP'] || this.state == STATE['ABORT']) {
        return await Promise.reject('state: ' + this.state)
    }

    const { uploadId, uploadName, doneParts } = this.fileState;

    const res = await this.client._completeMultipartUpload(uploadName, uploadId, doneParts);

    this.state == STATE['FINISH'];

    console.log(res)

    res.sourceLink = 'http://dev-pvideo-touchtv.oss-cn-shenzhen.aliyuncs.com/' + this.fileState.uploadName;

    this.options.complete && this.options.complete(res);

    return res;
                          
}

/**
 * 取消上传，uploadId不再可用,需要服务器支持delete
 */
OSSUploader.prototype.abort = async function () {

    //上传状态    
    this.state = STATE['STOP'];

    //文件状态
    this.fileState = {
        file: null,
        name: null,
        uploadName: null,
        fileSize: null,
        partSize: null,
        numParts: 0,
        //uploadId
        uploadId: null,

        //上传成功parts
        doneParts: [],

        //文件分块存储
        multipartList: []
    }

    this.checkpoint = null;
    
}


/**
 * 获取上传名字
 */
OSSUploader.prototype.createName = function (filename, len) {

    var pos = filename.lastIndexOf('.');

    var suffix = '';

    if (pos != -1) {

        suffix = filename.substring(pos);

    }

    return this.options.dir + this.md5 + suffix;

    // len = len || 32;

    // var chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
    
    // var maxPos = chars.length;

    // var pwd = '';

    // for (var i = 0; i < len; i++) {
    //     pwd += chars.charAt(Math.floor(Math.random() * maxPos));
    // } 

    // return pwd += Date.parse(new Date()) / 1000 + suffix;   
}

/**
 * 暂停
 */
OSSUploader.prototype.stop = function (file) {
    console.log('stop')
    this.state = STATE['STOP'];
}

/**
 * 暂停后继续开始
 */
OSSUploader.prototype.resume = async function () {
 
    this.state = STATE['UPLOADING'];

    try {
        await this.multipartUpload();

        const res = await this.completeMultipartUpload();

        await res;

    } catch (err) {
        
        this.state == STATE['STOP'];

        return this.errorHelp(err);
    }
    
}

/**
 * 开始
 */
OSSUploader.prototype.start = async function start() {
 
    this.state = STATE['UPLOADING'];
   
    await this.multipartUpload();

    const res = await this.completeMultipartUpload();

    return res;

}

OSSUploader.prototype.getUploadList = async function (query) {

    const { uploadName, uploadId } = this.fileState;

    // const res = await this.client.listUploads({
    //     // 'max-keys': 100
    // });


    // uploadId 
    var options = options || {};
    options.subres = {uploadId: uploadId};
    var params = this.client._objectRequestParams('GET', uploadName, options)
    params.query = query;
    params.xmlResponse = true;
    params.successStatuses = [200];

    var result = await this.client.request(params);

    console.log(result)

    var uploads = result.data.Part || [];

    if (!Array.isArray(uploads)) {
        uploads = [uploads];
    }

    //顺序
    for (let i = 0; i < uploads.length; i++) {
        this.fileState.doneParts.push({
            number: parseInt(uploads[i].PartNumber),
            etag: uploads[i].ETag
        });

        this.fileState.multipartList[i].status = 1;

    }    

    console.log(this)
}


/**
 * 错误处理promise
 */
OSSUploader.prototype.errorHelp = function (err) {
    console.log('err')
    console.log(err.name)
    console.log(err)

    var err = {
        code: ERROR_CODE[err.name] || 'other',
        message: err.name || err
    }

    this.options.error && this.options.error(err);

    return err;

}


/**
 * 保存checkpoints
 *
 */
OSSUploader.prototype.saveCheckPoint = function (name, checkpoint) {

    var savedLog = localStorage.videoUpload ? JSON.parse(localStorage.videoUpload) : {};

    savedLog[name] = checkpoint;

    localStorage.videoUpload = JSON.stringify(savedLog);
}

/**
 * 读取checkpoints
 */
OSSUploader.prototype.readCheckPoint = function (name, file) {

    var savedLog = localStorage.videoUpload ? JSON.parse(localStorage.videoUpload) : {};

    savedLog[name].file = file;

    return savedLog[name];
}


/**
 * 启动入口
 */
OSSUploader.prototype.begin = async function (file) {
    console.log('begin')

    this.state = STATE['START'];

    this.initFileState(file);

    try {

        await this.initMultipartUpload();
        await this.getUploadList();
        const res = await this.start(file);

        console.log(res)

        await res;

    } catch (err) {
        this.state == STATE['STOP'];

        return this.errorHelp(err);
    }

    
}


OSSUploader.prototype.Exception = function (opts) {
    const { name, code, descr } = opts;
    this.name = name;
    this.code = code;
    this.descr = descr;
}


module.exports = OSSUploader;
