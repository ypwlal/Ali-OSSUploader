# Ali-OSSUploader

基于阿里云sdk重构

reference [aliyun-oss](https://github.com/ali-sdk/ali-oss)

### features

* support file format filter

* support pause/stop/paresume/abort

* support auto/manual update/refresh token

* support heartbeat

* fix 500mb error

### example

```javascript

        //valid token, support immutable/obj
        var token = {
            region,
            accessKeyId,
            accessKeySecret,
            stsToken,
            bucket,
            dir
        }


        var default_options = {
            token: null,
            maxSize: 1024, //单位MB
            before: null,
            progress: null,
            complete: null,
            error: null,
            handleExpire: null,//过期expire callback
            watchbeat: null,
            watchHeatInterval: 1800000, //half hour
            secure: true, //true for https, false for http
            upload_button: null,
            container: null,
            partSize: 2, //单位MB
            types: ['video/mp4', 'video/3gpp', 'video/mpeg', 'video/x-flv', '.flv', '.avi'], // 'video/* 响应很卡，需要把通配符换成具体
            retry_count: 2, //retry count
            manualUpdate: true //默认手动更新token，通过this.updateValid, 
            //if this is false, handleExpire should be a promise and resolve with a object which has token
        }


        var sourceUploader = new Client({

            upload_button: 'videoUpload-button', //{string}the button's id to trriger upload

            container: 'videoUpload-container', //the container element's id of the upload_button

            token: token, //token

            watchbeat: heartBeat, //default null, expected function

            handleExpire: handleExpire, //default null, expected function, trriger when aliyun return InvalidAccessKeyIdError

            maxSize: 2048, //maxSize, Mb

            partSize: 2, //Mb

            types: ['.flv','.mpg','.mpeg','.avi','.wmv','.mov','.asf','.rm','.rmvb','.mkv','.m4v','.mp4'],

            before: (file) => {
                
            },

            progress: (filePercent) => {

            },

            complete: (res) => {
                //res: {name, sourceLink}
            },

            error: (err) => {
            }
        });

```

## API:

* begin: sourceUploader.begin();
* stop: sourceUploader.stop();
* resume: sourceUploader.resumeUpload();
* updateValid: sourceUploader.updateValid();
* abort: sourceUploader.abort();
* clear: sourceUploader.clear(); //if has heartBeat, this will clear that
