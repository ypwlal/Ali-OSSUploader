/**
 * OSS 大文件断点上传multipleUploader
 *
 */
import 'babel-polyfill';
import SparkMD5 from 'spark-md5';
import Jquery from 'jquery';

const urllib = {
    request: function(url, args) {
        console.log(args)
        return new Promise(function(resolve, reject){
            Jquery.ajax({
                type: args.method || 'post',
                url: url,
                headers: args.headers,
                dataType: 'XML',
                data: args.stream ? args.stream : {},
                contentType: args.stream ? 'multipart/form-data' : 'application/x-www-form-urlencoded'
            }).done( res => {
                console.log(res);
                var oSerializer = new XMLSerializer();
                var sXML = oSerializer.serializeToString(res);
                var result = {
                    status: 200,
                    headers: args.headers,
                    data: sXML,
                    res: res
                }
                resolve(result);
                
            }).fail(xhr => {
                console.log(xhr);
                var result = {
                    status: 400,
                    headers: args.headers,
                    data: xhr,
                    res: xhr
                }
                reject(result);
            })
        })
    }
}


export const STATE = {
    'START': 0,
    'STOP': 1,
    'UPLOADING': 2,
    'ABORT': 3,
    'FINISH': 4
}

export const ERROR_CODE = {
    'InvalidAccessKeyIdError': -200,
    'NoSuchUploadError': -602,
    'Parse': 100,
    'sizeError': -600,
    'formatError': -601,
    'RequestError': -602
}

function OSSUploader(options) {

    this.options = {
        maxSize: options.maxSize || 1024, //单位MB
        before: options.before,
        progress: options.progress,
        complete: options.complete,
        error: options.error,
        dir: '',
        secure: options.secure || true,
        upload_button: options.upload_button || null,
        container: options.container || null,
        partSize: options.partSize || 5, //单位MB
        types: options.types || ['video/mp4', 'video/3gpp', 'video/mpeg', 'video/x-flv', '.flv', '.avi'], // 'video/* 响应很卡，需要把通配符换成具体
        retry_count: options.retry_count || 2,
        parallel: 1
    }

    this._options = options;

    //上传状态    
    this.state = STATE['STOP'];

    //文件状态
    this.fileState = {
        sourceName: null,
        file: null,
        name: null,
        fileSize: null,
        numParts: 0,
        //uploadId
        uploadId: null,

        //上传成功parts
        doneParts: []
    }

    this.md5 = '';

    this.checkpoint = {};

    //认证信息
    this.validParams = {};

    //client对象
    this.client = null;

    this.inputDiv = null;

    this.initValidParams(options);

    this.init();

    this.initCSS();

}

OSSUploader.prototype.init = function () {
    this.client = new OSS.Wrapper({ ...this.validParams});
}

OSSUploader.prototype.initValidParams = function (options) {

    if (!options.token) {

        console.warn('缺少token');

        return;
    }

    this.validParams = {
        secure: options.secure || true,
        region: options.token.get ?  options.token.get('region') : options.token.region,
        accessKeyId: options.token.get ?  options.token.get('accessKeyId') : options.token.accessKeyId,
        accessKeySecret: options.token.get ?  options.token.get('accessKeySecret') : options.token.accessKeySecret,
        stsToken: options.token.get ? options.token.get('stsToken') : options.token.stsToken,
        bucket: options.token.get ?  options.token.get('bucket') : options.token.bucket,
    }

    this.options.dir = options.token.get ? options.token.get('dir') : options.token.dir;
    

    // this.validParams = {
    //     region: "oss-cn-shenzhen",
    //     accessKeyId: 'STS.LuhhG52NzGgDRJoJ5dQiVu2Vg',
    //     accessKeySecret: "8iePVtLuiBTopVGEkv1LhU3EjKPoX3mZBWh4Fy75y2HA",
    //     stsToken: 'CAIS/wF1q6Ft5B2yfSjIrbbdI/2B35Fb8KWvUGzerjUxXeZ6mvf9hTz2IHpLdHVhBeAftPowmmpR7/sblqJ4T55IQ1Dza8J148zhUeYWqMmT1fau5Jko1beHewHKeTOZsebWZ+LmNqC/Ht6md1HDkAJq3LL+bk/Mdle5MJqP+/UFB5ZtKWveVzddA8pMLQZPsdITMWCrVcygKRn3mGHdfiEK00he8Tolsv7jnJ3NskqE1g2hkL8vyt6vcsT+Xa5FJ4xiVtq55utye5fa3TRYgxowr/0p3PAVpWee5I/CXQMIukjfKZfd9tx+MQl+fbMnA6pDpfT1nvZ1offDFxF9GLa4zYsagAGoxluN8VgyF5eYmFb4PSquiCoztTTI9Ga7bYzdLCevh+HebV6up2y3YdL2+DwoMIJnwge6pospPJ/o0p+Fddm9sm2HIKm4Zxh53UoDmsmKN8ziceL++y8TCy2MXU1n2zaAqFKpsSj1FP2L6roPC0xo7W+qeZkcHjRYCAbxz3D1Ww==',
    //     bucket: "dev-pvideo-touchtv"
    // }



}

OSSUploader.prototype.initCSS = function () {

    if (!this.options.upload_button || !this.options.container) {
        console.warn('缺少上传按钮id和父元素id')
        return;
    }

    const { upload_button, container } = this.options;

    document.getElementById(container).style.position = 'relative';

    this.inputDiv = document.createElement('input');

    this.inputDiv.type = 'file';
    this.inputDiv.accept = this.options.types.join(',');

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
        this.inputDiv.style[item] = uploadButtonStyle[item];
    });

    //如果没有获取到父元素的宽高，则绑定点击事件
    var isZero = !document.getElementById(container).offsetWidth;

    this.inputDiv.style.width = document.getElementById(container).offsetWidth + 'px';
    this.inputDiv.style.height = document.getElementById(container).offsetHeight + 'px';


    document.getElementById(container).appendChild(this.inputDiv);

    if (isZero) {
        document.getElementById(upload_button).onclick = () => { 
            console.log(this.inputDiv.value)
            
            this.inputDiv.click();
        };
    }
    

    this.inputDiv.onchange = () => { 
        console.log('onchange')
        var file = this.inputDiv.files[0];

        //清空文件域
        if (this.inputDiv.value) {
            this.inputDiv.value = '';
        }

        if (!file) {
            return;
        }

        console.log(this.inputDiv.files[0])
        this.begin(file);
    };
}

/**
 * 初始化file
 */
OSSUploader.prototype.initFileState = function (file) {

    var partSize = (this.options.partSize || 10) * 1024 * 1024;

    //md5
    var sparkMd5 = new SparkMD5();

    //分块    
    var partOffs = this.client._divideParts(file.size, partSize);

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
        data.stream = null;
    }

    this.md5 = sparkMd5.end();


    const cpt = this.readCheckPoint(this.md5, file);

    if (cpt.uploadId) {
        this.fileState = cpt;
        this.fileState.sourceName = file.name;
    } else {
        this.fileState.file = file;
        this.fileState.fileSize = file.size;
        this.fileState.sourceName = file.name;
        this.fileState.uploadName = this.createName(file.name, 16);
    }
    
    this.options.before && this.options.before(file, this);

}


/**
 * 取消上传，uploadId不再可用,需要服务器支持delete
 */
OSSUploader.prototype.abort = async function () {

    //上传状态    
    this.state = STATE['STOP'];

    //中断xhr， 后期更换request函数
    //window.stop && window.stop();

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
    this.md5 = null;
}


/**
 * 获取上传名字
 */
OSSUploader.prototype.createName = function (filename, len) {

    var pos = filename.lastIndexOf('.');

    var now = Date.parse(new Date()) / 1000;

    var suffix = '';

    if (pos != -1) {

        suffix = filename.substring(pos);

    }


    return this.options.dir + this.md5 + now + suffix;

    //return this.options.dir + 'test' +suffix;

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

    //中断xhr， 后期更换request函数
    //window.stop && window.stop();

}

/**
 * 错误类
 */

OSSUploader.prototype.Exception = function (opts) {
    const { name, code, descr } = opts;
    this.name = name;
    this.code = code;
    this.descr = descr;
}


/**
 * 错误处理promise
 */
OSSUploader.prototype.errorHelp = function (err) {
    console.log('err')
    console.log(err.name)
    console.log(err)

    if (err.name == 'NoSuchUploadError') {
        this.clearCheckPoint(this.md5);
        this.abort();
    }

    var err = {
        code: ERROR_CODE[err.name] || 'other',
        message: err.name || err
    }

    if (err.code == -602) {
        this.clearCheckPoint(this.md5);
        this.abort();
    }

    this.options.error && this.options.error(err);

    return err;

}


/**
 * 保存checkpoints
 *
 */
OSSUploader.prototype.saveCheckPoint = function (checkpoint) {
    console.log('save')
    var savedLog = localStorage[this.md5] ? JSON.parse(localStorage[this.md5]) : {};

    savedLog = checkpoint;
    savedLog.sourceName = this.fileState.sourceName;

    localStorage[this.md5] = JSON.stringify(savedLog);
}

/**
 * 读取checkpoints
 */
OSSUploader.prototype.readCheckPoint = function (md5, file) {

    var savedLog = localStorage[md5] ? JSON.parse(localStorage[md5]) : {};

    var compareDir = function (name, dir) {

        if (!name) {
            return false
        }

        return name.indexOf(dir) >= 0;
        
    }

    if (savedLog &&  compareDir(savedLog.name, this.options.dir)) {
        savedLog.file = file;
        return savedLog;
    } else {
        return {};
    }

}

/**
 * 清除checkpoint
 */
OSSUploader.prototype.clearCheckPoint = function (md5) {

    if (localStorage[md5]) {
        localStorage.removeItem(md5);
    }

}

/**
 * 清除最后一次checkpoint
 */
OSSUploader.prototype.clearLastCheckPoint = function (md5) {

    return;

    var savedLog = localStorage[md5] ? JSON.parse(localStorage[md5]) : {};

    if (!savedLog) {
        return;
    }

    let len = savedLog.doneParts.length;

    savedLog.doneParts.pop();
    savedLog.nextPart = savedLog.doneParts.length;
    localStorage[md5] = JSON.stringify(savedLog);
}


/**
 * 校验文件
 */
OSSUploader.prototype.validFile = function (file) {

    console.log(file)

    // 大小判断
    if (this.options.maxSize && file.size > this.options.maxSize * 1024 * 1024) {
        this.inputDiv.value = '';
        throw new this.Exception({
            name: 'sizeError'
        });
    }

    //根据后缀判断类型  
    var pos = file.name.lastIndexOf('.');

    var suffix = '';

    if (pos != -1) {

        suffix = file.name.substring(pos);

    }

    console.log(suffix)

    //根据文件type判断类型（firefox读取flv格式type为空）
    if (file.type.split('/')[0] != 'video' && this.options.types.findIndex(type => type == suffix) < 0) {
        this.inputDiv.value = '';
        throw new this.Exception({
            name: 'formatError'
        });
    }
}

/**
 * 重新init
 */
OSSUploader.prototype.reInit = function() {
    console.log('reinit')
    this.client = null;

    this.initValidParams(this._options);

    this.init();
} 

/**
 * 启动入口
 */
OSSUploader.prototype.begin = async function (file) {

    console.log('begin')

    try {
        this.validFile(file);
    } catch (err) {
        this.state = STATE['STOP'];

        return this.errorHelp(err);
    }
    

    this.state = STATE['START'];

    this.initFileState(file);

    this.checkpoint = this.readCheckPoint(this.md5, file);

    this.upload(file, this.checkpoint);

}


/**
 * 原生实现
 */
OSSUploader.prototype.upload = async function (file, checkpoint) {

    this.state = STATE['START'];

    var self = this;

    const { partSize, progress, complete, parallel } = this.options;

    try {    

        const res = await this.client.multipartUpload(this.fileState.uploadName, file, {

            parallel: parallel,

            partSize: partSize * 1024 * 1024,

            checkpoint: checkpoint,

            progress: function* (per, cpt) {
                console.log(cpt)

                checkpoint = cpt;

                if (self.state == STATE['STOP']) {
                    console.log('throw stop')
                    throw new self.Exception({
                        name: 'Parse'
                    })
                }

                progress && progress(per, cpt)
            }
        })

        self.clearCheckPoint(this.md5)

        this.state = STATE['STOP'];

        console.log(res)

        const result = {
            name: res.name,
            sourceLink: res.res.requestUrls[0].split('?')[0]
        }

        complete && complete(result);

    } catch(err) {

        console.log('stop')
        console.log(err)
        this.state = STATE['STOP'];
        return this.errorHelp(err);
            
    }
}

/**
 * 原生暂停后继续开始
 */
OSSUploader.prototype.resumeUpload = async function () {
 
    this.state = STATE['UPLOADING'];

    this.upload(this.fileState.file, this.readCheckPoint(this.md5, this.fileState.file));
        
}

module.exports = OSSUploader;
