import crypto from 'crypto';
import is from 'is-type-of';
import dateFormat from 'dateformat';
import xml from 'xml2js';
import multipartProto from './multipart';
import checkpointProto from './checkpoint';

export const STATE = {
    'START': 0,
    'STOP': 1,
    'PAUSE': 5,
    'UPLOADING': 2,
    'ABORT': 3,
    'FINISH': 4
}

export const STATUS = {
    'NULL': 0,
    'initMultipartUpload': 'initMultipartUpload',
    'resumeMultipart': 'resumeMultipart',
    'completeMultipartUpload': 'completeMultipartUpload'
}

export const ERROR_CODE = {
    'SignatureDoesNotMatch': -200,
    'InvalidAccessKeyId': -200,
    'NoSuchUpload': -602,
    'Pause': 100,
    'sizeError': -600,
    'formatError': -601,
    'RequestError': -603,
    'RequestTimeTooSkewed': -604,
    'browserNotSupport': -605
}

export const PLUGIN_ERROR_CODE = {
    'Pause': 100,
    'sizeError': -600,
    'formatError': -601,
    'browserNotSupport': -605
}


function Client(options) {

    this.options = {
        token: null,
        maxSize: 1024, //单位MB
        before: null,
        progress: null,
        complete: null,
        error: null,
        handleExpire: null,//过期expire callback
        watchbeat: null,
        watchHeatInterval: 1800000, //half hour
        secure: true,
        upload_button: null,
        container: null,
        partSize: 2, //单位MB
        types: ['video/mp4', 'video/3gpp', 'video/mpeg', 'video/x-flv', '.flv', '.avi'], // 'video/* 响应很卡，需要把通配符换成具体
        retry_count: 2,
        parallel: 1,
        manualUpdate: true, //默认手动更新token，通过this.updateValid
        saveChunk: false //if save checkpoint 
    }
    

    this.initOpts(options);

    this.initValid(this.options.token);
    
    this.initCSS();

    this.initEvent();

    this.initState();


}

/**
 * prototype
 */

var proto = Client.prototype;

var protoKeys = Object.keys(multipartProto);
for (let i = 0; i <protoKeys.length; i++) {
    proto[protoKeys[i]] = multipartProto[protoKeys[i]];
}

protoKeys = Object.keys(checkpointProto);
for (let i = 0; i <protoKeys.length; i++) {
    proto[protoKeys[i]] = checkpointProto[protoKeys[i]];
}

proto.initState = function () {
    console.log('initState')
    //时间
    this.delta_time = 0;

    //上传状态    
    this.state = STATE['STOP'];
    this.status = STATUS['NULL'];

    this.currentXhr = null;

    this.checkpoint = null;

    this.hasReValid = false; //avoid repeat handleExpire

    this.retryCount = this.options.retry_count;

    this.watchBeatHeart = null;

    this.md5 = null;

    this.uniqueId = null;

    this.inputDiv.value = '';
}

proto.initEvent = function () {
    
    if (this.options.saveChunk) {
        this.event = (event) => {
            this.saveCheckpoint();
            event.returnValue = "我在这写点东西...";
        };

        var self = this;
        window.addEventListener("beforeunload", this.event);
    }
}

proto.initOpts = function(options) {
    var key = Object.keys(options);
    for (let i = 0; i < key.length; i++) {
        var value = key[i];
        this.options[value] = options[value];
    }
}

proto.initCSS = function () {

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
            
            this.inputDiv.click();
        };
    }
    

    this.inputDiv.onchange = () => { 

        var file = this.inputDiv.files[0];

        //清空文件域
        if (this.inputDiv.value) {
            this.inputDiv.value = '';
        }

        if (!file) {
            return;
        }

        this.begin(file);
    };
}

proto.initValid = function(token) {

    if (!token) {

        console.warn('缺少token');

        return;
    }

    this.options.region = token.get ?  token.get('region') : token.region;
    this.options.accessKeyId = token.get ?  token.get('accessKeyId') : token.accessKeyId;
    this.options.accessKeySecret = token.get ? token.get('accessKeySecret') : token.accessKeySecret;
    this.options.stsToken = token.get ? token.get('stsToken') : token.stsToken;
    this.options.bucket = token.get ?  token.get('bucket') : token.bucket;
    this.options.dir = token.get ? token.get('dir') : token.dir;

    // setTimeout( () => {
    //     this.options.accessKeySecret = 'aaaa';
    // }, 10000)
}

proto.getTime = function() {
    return new Date().getTime() + this.delta_time;
}


/**
 *  serverTime: timestamp like 1491377260313
 */
proto.setTimeDelta = function(serverTime) {
    if (!serverTime) {
        this.delta_time = 0;
    } else {
        this.delta_time = new Date(serverTime).getTime() - new Date().getTime();
    }
}

/**
 * 
   method: "PUT"
   mime:undefined
   object:"article/20170316/479a79945aaa81657cdcda636fc112f01489644079.mp4"
   subres:Object,
   content,
   data
*/

proto.getHeader = function(params) {

    //var userAgent = this.getUserAgent();

    var headers = {
        'x-oss-date': dateFormat(this.getTime(), 'UTC:ddd, dd mmm yyyy HH:MM:ss \'GMT\'')
    };

    headers['Content-Type'] = params.mime || '';

    if (this.options.stsToken) {
        headers['x-oss-security-token'] = this.options.stsToken;
    }

    if (params.content) {
        headers['Content-Md5'] = crypto
        .createHash('md5')
        .update(new Buffer(params.content, 'utf8'))
        .digest('base64');
    }


    var authResource = this.getResource(params);
    headers.authorization = this.authorization(params.method, authResource, params.subres, headers);

    return headers;

}

proto.authorization = function(method, resource, subres, headers) {
    var params = [
        method.toUpperCase(),
        headers['Content-Md5'] || '',
        headers['Content-Type'] || '',
        headers['x-oss-date']
    ];

    var ossHeaders = {};
    for (var key in headers) {
        var lkey = key.toLowerCase().trim();
        if (lkey.indexOf('x-oss-') === 0) {
        ossHeaders[lkey] = ossHeaders[lkey] || [];
        ossHeaders[lkey].push(String(headers[key]).trim());
        }
    }

    var ossHeadersList = [];
    Object.keys(ossHeaders).sort().forEach(function (key) {
        ossHeadersList.push(key + ':' + ossHeaders[key].join(','));
    });

    params = params.concat(ossHeadersList);
    var resourceStr = '';
    resourceStr += resource;

    var subresList = [];
    if (subres) {
        if (is.string(subres)) {
            subresList.push(subres);
        } else if (is.array(subres)) {
            subresList = subresList.concat(subres);
        } else {
            for (var k in subres) {
                var item = subres[k] ? k + '=' + subres[k] : k;
                subresList.push(item);
            }
        }
    }

    if (subresList.length > 0) {
        resourceStr += '?' + subresList.join('&');
    }
    params.push(resourceStr);
    var stringToSign = params.join('\n');

    var auth = 'OSS ' + this.options.accessKeyId + ':';

    return auth + this.signature(stringToSign);

}

proto.getUserAgent = function() {

  return 'aliyun-sdk-js/4.4.4 Chrome 56.0.2924.87 on Windows 10 64-bit';

}

proto.getResource = function(params) {
  var resource = '/';
  resource += this.options.bucket + '/';
  if (params.object) resource += params.object;

  return resource;
};

proto.signature = function(stringToSign) {
    var signature = crypto.createHmac('sha1', this.options.accessKeySecret);
    signature = signature.update(new Buffer(stringToSign, 'utf8')).digest('base64');

    return signature;
}

/**
 * object
 * subres
 */
proto.getUrl = function(options) {

    var resourceStr = '';
    var subresList = [];
    if (options.subres) {
        if (is.string(options.subres)) {
            subresList.push(options.subres);
        } else if (is.array(options.subres)) {
            subresList = subresList.concat(options.subres);
        } else {
            for (var k in options.subres) {
                var item = options.subres[k] ? k + '=' + options.subres[k] : k;
                subresList.push(item);
            }
        }
    }

    if (subresList.length > 0) {
        resourceStr += '?' + subresList.join('&');
    }

    return 'https://' + this.options.bucket + '.' + this.options.region + '.aliyuncs.com' + '/' + options.object + resourceStr;
}


/**
 * method, 
 * object, 
 * subres,
 * data
 */

proto.request = function (options) {

    const { method, data, content } = options;

    var url = this.getUrl(options);
    var headers = this.getHeader(options);

    var self = this;

    return new Promise(function(resolve, reject){

        var currentXhr = self.currentXhr = new XMLHttpRequest();

        currentXhr.open(method, url);

        var keys = Object.keys(headers);
        for(let i = 0; i < keys.length; i++) {
            currentXhr.setRequestHeader(keys[i], headers[keys[i]]);
        }

        currentXhr.responseType = 'text';

        currentXhr.onreadystatechange = function() {

            if (currentXhr.readyState == 4) {

                var status = currentXhr.status;

                if (status != 200) {
                    xml.parseString(currentXhr.response, { explicitRoot: false, explicitArray: false}, (err, xmlJson) => {
                        return reject({
                            status: status,
                            data: xmlJson
                        })
                    })
                } else {
                    if (method == 'PUT') {
                        var etag = currentXhr.getResponseHeader('ETag');
                        return resolve({
                            status: status,
                            headers: {
                                etag: etag.replace(/\"/g, '')
                            }
                        })
                    } else {
                        xml.parseString(currentXhr.response, { explicitRoot: false, explicitArray: false}, (err, xmlJson) => {
                            return resolve({
                                status: status,
                                data: xmlJson
                            })
                        })
                    }
                }
            }
        }

        currentXhr.send(content || data);

    })
}

/**
 * watch beatheart 心跳包
 */
proto.watchBeat = function() {

    if (!this.options.watchbeat) {
        return;
    }

    this.options.watchbeat();

    var self = this;
    this.watchBeatHeart = clearInterval(this.watchBeatHeart);
    this.watchBeatHeart = setInterval(function() {
        self.options.watchbeat();
    }, self.options.watchHeatInterval)
}

/**
 * watch beatheart 心跳包
 */
proto.stopWatchBeat = function() {

    if (!this.options.watchbeat) {
        return;
    }

    this.watchBeatHeart = clearInterval(this.watchBeatHeart);
    
}


proto.handleExpire = async function() {
    console.log('expire')

    if (this.options.manualUpdate) {

        this.stop();

        this.options.handleExpire();

        this.hasReValid = true;

    } else {

        this.stop();

        try {
            this.hasReValid = true;

            const res = await this.options.handleExpire();

            this.hasReValid = false;

            this.updateValid(res.token);

        } catch (err) {

            return this.errorHelp(err);

        }

    }
}


/**
 * destroy
 */
proto.clear = function() {

    this.stopWatchBeat();

    this.currentXhr && this.currentXhr.abort();
   
    this.state = STATE['STOP'];

    this.initState();

    if (this.options.saveChunk) {
        window.removeEventListener("beforeunload", this.event);
    }
}

/**
 * 错误类 error class
 * { data, status, cb }
 * 
 */

proto.Exception = function (opts) {
    const { Code } = opts;

    this.data = {
        Code: Code
    }
}


/**
 * 错误处理error
 */
proto.errorHelp = async function (err) {

    if (this.state == STATE['PAUSE']) {
        return;
    }
    
    this.state == STATE['STOP'];

    this.saveCheckpoint();

    var err;
    console.log(err)
    if (!err.data) {
        err = {
            code: 'other',
            message: '网络错误，请检查网络'
        }
    } else {
        const { Code, Message } = err.data;

        err = {
            code: ERROR_CODE[Code] || 'other',
            message: Message || err,
            data: err.data
        }

    }

    if (err.code == -604) {

        this.setTimeDelta(err.data.ServerTime);
        return this.resumeUpload();
    }

    if (err.code == -200 && this.options.handleExpire && !this.hasReValid) {
        return this.handleExpire();
    }

    if (err.code == 'other' && this.retryCount) {
        this.retryCount--;
        return this.resumeUpload();
    }

    this.stop();

    this.stopWatchBeat();

    this.initState();

    this.options.error && this.options.error(err);

    return err;

}

export default Client;

