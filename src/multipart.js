import { STATE, STATUS } from './index.js';
import SparkMD5 from 'spark-md5';

var proto = {};

proto.sliceBlob = function (blob, start, end) {

    if(blob.slice){
        return  blob.slice(start, end);
    }
    // 兼容firefox
    if(blob.mozSlice){
        return  blob.mozSlice(start, end);
    }
    // 兼容webkit
    if(blob.webkitSlice){
        return  blob.webkitSlice(start, end);
    }

    throw new this.Exception({
            Code: 'browserNotSupport'
        });
}

/**
 * 初始化file
 */
proto.initFileState = function (file) {

    var partSize = (this.options.partSize || 10) * 1024 * 1024;

    //md5
    var sparkMd5 = new SparkMD5();

    //分块    
    var partOffs = this.divideParts(file.size, partSize);

    var numParts = partOffs.length;

    for (var i = 0; i < numParts; i++) {
        var pi = partOffs[i];
        var data = this.sliceBlob(file, pi.start, pi.end);
        sparkMd5.appendBinary(data);
        data = null;
    }

    this.md5 = sparkMd5.end();

    this.options.before && this.options.before(file, this);

}

/**
 *  create file upload name
 */

proto.createName = function (file, len) {

    if (!file) {
        console.warn('no file!')
        return;
    }

    var filename = file.name;

    var pos = filename.lastIndexOf('.');

    var now = Date.parse(new Date()) / 1000;

    var suffix = '';

    if (pos != -1) {

        suffix = filename.substring(pos);

    }

    this.uniqueId = this.options.dir + this.md5;

    return this.options.dir + this.md5 + now + suffix;

}

/**
 * 校验文件valid file
 */
proto.validFile = function (file) {

    // 大小判断
    if (this.options.maxSize && file.size > this.options.maxSize * 1024 * 1024) {
        this.inputDiv.value = '';
        throw new this.Exception({
            Code: 'sizeError'
        });
    }

    //根据后缀判断类型  
    var pos = file.name.lastIndexOf('.');

    var suffix = '';

    if (pos != -1) {

        suffix = file.name.substring(pos).toLowerCase();

    }


    //根据文件type判断类型
    if (this.options.types.findIndex(type => type.toLowerCase() == suffix) < 0) {
        this.inputDiv.value = '';
        throw new this.Exception({
            Code: 'formatError'
        });
    }
}

/**
 *  init uploadId
 *  @return status
 *  @return data: {uploadId}
 */

proto.initMultipartUpload = async function() {
    console.log('initMultipartUpload')

    this.state = STATE['START'];
    this.status = STATUS['initMultipartUpload'];

    const { name } = this.checkpoint;

    var params = {
        object: name,
        method: 'POST',
        subres: 'uploads'
    }

    try {

        var result = await this.request(params);

        if (!this.checkpoint.uploadId) {
            this.checkpoint.uploadId = result.data.UploadId;
        }

    } catch(err) {
        this.checkpoint.uploadId = '';
        this.errorHelp(err);
    }

    if (this.checkpoint && this.checkpoint.uploadId) {
        this.status = STATUS['resumeMultipart'];
        return { success: true }
    } else {
        return { success: false }
    }

}

/**
 * 逐片上传
 * return {
 *    status,
 *    headers: {
 *       etag
 *    }
 * }
 */

proto.uploadPart = async function (name, uploadId, partNo, data) { 

    var options = {
        method: "PUT",
        object: name,
        subres: {
            partNumber: partNo,
            uploadId: uploadId
        },
        data: data
    }

    var result = await this.request(options);

    return result;

}

/**
 *  继续上传，读取checkpoints
 */

proto.resumeMultipart = async function() {

    console.log('resumeMultipart')

    this.status = STATUS['resumeMultipart'];

    console.log(this.checkpoint)

    const { file, fileSize, partSize, uploadId, doneParts, name } = this.checkpoint;


    var partOffs = this.divideParts(fileSize, partSize);
    var numParts = partOffs.length;

    var all = Array.from(new Array(numParts), (x, i) => i + 1);
    var done = doneParts.map(p => p.number);
    var todo = all.filter(p => done.indexOf(p) < 0);


    for (let i = 0; i < todo.length; i++) {

        var partNo = todo[i];

        var data = this.sliceBlob(file, partOffs[partNo - 1].start, partOffs[partNo - 1].start + partSize);

        try {
            var res = await this.uploadPart(name, uploadId, partNo, data);
        } catch(err) {
            return this.errorHelp(err);
        }
        

        doneParts.push({
            number: partNo,
            etag: res.headers.etag
        })

        data = null;

        this.hasReValid = false;

        if (this.options && this.options.progress) {
            await this.options.progress(doneParts.length / numParts, this.checkpoint);
        }

    }

    return this.completeMultipartUpload();
    
}

/**
 * complete upload
 */

proto.completeMultipartUpload = async function() {

    console.log('completeMultipartUpload')

    this.status = STATUS['completeMultipartUpload'];

    const { doneParts, name, uploadId } = this.checkpoint;

    doneParts.sort((a, b) => a.number - b.number);

    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload>\n';
    for (var i = 0; i < doneParts.length; i++) {
        var p = doneParts[i];
        xml += '<Part>\n';
        xml += '<PartNumber>' + p.number + '</PartNumber>\n';
        xml += '<ETag>' + p.etag + '</ETag>\n';
        xml += '</Part>\n';
    }
    xml += '</CompleteMultipartUpload>';

    var params = {
        method: 'POST',
        object: name,
        subres: {
            uploadId: uploadId,
        },
        mime: 'application/xml',
        content: xml
    }

    const res = await this.request(params);

    this.state = STATE['STOP'];

    const result = {
        name: res.data.Key,
        sourceLink: res.data.Location
    }


    this.clearCheckpoint();
    this.initState();
    this.stopWatchBeat();

    this.options.complete && this.options.complete(result);


}

/**
 * divideParts
 * @return {array}
 */

proto.divideParts = function(fileSize, partSize) {

    var numParts = Math.ceil(fileSize / partSize);

    var partOffs = [];
    for (var i = 0; i < numParts; i++) {
        var start = partSize * i;
        var end = Math.min(start + partSize, fileSize);

        partOffs.push({
            start: start,
            end: end
        });
    }

    return partOffs;
}

/**
 *  abort (front-side)
 */
proto.abort = function() {
    console.log('abort')

    this.stop();

    this.initState();

    this.stopWatchBeat();
}

/**
 * stop
 */
proto.stop = function() {

    console.log('stop')
    

    if (this.state == STATE['STOP']) {
        return;
    }
    console.log('stop true')
    this.state = STATE['PAUSE'];

    this.currentXhr && this.currentXhr.abort();

    this.currentXhr = null;

    this.saveCheckpoint();

}

/**
 * resume
 */

proto.resumeUpload = async function() {

    console.log('resumeUpload')
    console.log(this.checkpoint)
    
    if (!this.checkpoint) {
        return;
    }

    if (!this.checkpoint.file) {
        return;
    }

    if (this.checkpoint.file && !this.checkpoint.uploadId) {
        return this.initUpload(this.checkpoint.file);
    }


    this.watchBeat();

    this.state = STATE['START'];
    console.log(this.status)
    console.log(this[this.status])
    this.status && this[this.status] && this[this.status]();
    
}

/**
 *  update expired
 */
proto.updateValid = async function(token) {
    console.log('update')

    //非停止状态先暂停
    if (this.state != STATE['STOP']) {

        console.log(this.state)

        this.stop();

        this.initValid(token);

        //abort has delay
        var self = this;
        this.delay = clearTimeout(this.delay);
        this.delay = setTimeout(function() {
            self.resumeUpload();
        }, 100)
        

    } else {

        this.initValid(token);
    }
    
}

/**
 * 开始
 */

proto.begin = async function (file) {

    console.log('begin')
    var success = false;

    try {
        this.validFile(file);

        this.initFileState(file);

        success = true;

    } catch(err) {

        this.errorHelp(err);

    }
    
    if (success) {

        this.initUpload(file);
    }
    

}

/**
 *  upload mian
 */
proto.initUpload = async function (file) {
    console.log('initUpload')
    var name = this.createName(file, 16);

    this.checkpoint = this.readCheckpoint();

    if (!this.checkpoint.name) {
        const { partSize } = this.options;
        //uploadId is updated in the {function}initMultipartUpload
        this.checkpoint.file = file;
        this.checkpoint.fileSize = file.size;
        this.checkpoint.partSize = partSize * 1024 * 1024;
        this.checkpoint.doneParts = [];
        this.checkpoint.name = name;

    } else {
        this.checkpoint.file = file;
    }

    console.log('-----------------------')
    console.log(this.checkpoint)

    var result = await this.initMultipartUpload(name);

    if (!result.success) {
        return;
    }
   
    // //test valid
    // setInterval( () => {
    //     this.options.accessKeyId = 'sdfsdf';
    // }, 10000)

    this.resumeUpload();
    
    
}

export default proto;
