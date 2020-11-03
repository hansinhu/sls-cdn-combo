const koa = require('koa');
const app = new koa();
const fs = require('fs');
const path = require('path');
const COSSDK = require('cos-nodejs-sdk-v5');
const asyncLib = require('async');
const moment = require('moment');

const Bucket = 'test-125000000',
  Region = 'ap-guangzhou';

const cos = new COSSDK({
  SecretId: '***************************',
  SecretKey: '***************************'
});

app.use(async (ctx, next) => {
  function getSuccComment(Key) {
    return `/***** ${Key} is combined from server *****/`
  }

  // 得到扩展名
  function getFileExtension(Key) { 
    let ext = path.extname(Key || '').split('.');
    return ext[ext.length - 1];
  } 

  // 返回文件格式
  function getContentType(ext) {
    const typeMap = {
      'js': 'application/x-javascript',
      'css': 'text/css'
    }
    return typeMap[ext]
  }

  // 检查请求是否有效，文件只允许有一个格式
  function check(fileKeyList) {
    let res = true,
        ext = '',
        type = '';
    fileKeyList.forEach((key) => {
      ext = getFileExtension(key)
      type = getContentType(ext)
      if (!ext) {
        res = false
      } else {
        if (!type) {
          res = false
        } else {
          filesExt[ext] = type
        }
      }
    })
    return res ? (Object.keys(filesExt).length == 1) : res
  }

  async function getFile() {
    return new Promise((resolve, reject) => {
      asyncLib.mapLimit(fileKeyList, 5, (Key, cb) => {
        cos.getObject({
          Bucket,
          Region,
          Key
        }, (err, data) => {
          if (err) {
            return cb(err)
          }
          filesContent.push(getSuccComment(Key))
          filesContent.push(data.Body)
          
          let mtime = moment(data.headers['Last-Modified'])
          if (mtime && mtime > lastModifiedTime) {
            lastModifiedTime = mtime
          }
    
          return cb(null)
        })
      }, (err) => {
        if (err) {
          return reject(err)
        }
        resolve()
      })
    })
  }

  // 兼容逻辑。当直接请求单个文件，不开启combo特性时，则直接返回源站对应的文件Url
  if (!decodeURIComponent(ctx.querystring).startsWith('?')) {
    let cosUrl = ctx.href.replace(/(\w*:\/\/)([^\/]*)([\s\S]*)/, `$1${Bucket}.cos.${Region}.myqcloud.com$3`)
    if (ctx.headers.Authorization) {
      cosUrl = `${cosUrl}?Authorization=${ctx.headers.Authorization}`
    }
    return ctx.redirect(cosUrl)
  }

  let filesExt = {}
  let filesContent = []
  let lastModifiedTime = 0
  let resHeaders = {}
  let resBody = ''

  // 获取请求的文件路径
  let fileKeyList = Object.keys(ctx.query || {}).map((key) => {
    // 将开头的?和/去掉
    return key.replace(/(\?)*(\/)*(.*)/, '$3')
  })

  if (ctx.path === '/favicon.ico') {
    ctx.status = 200
    return
  }

  // 检查请求是否有效，文件只允许有一个格式
  if (!check(fileKeyList)) {
    ctx.status = 400
    ctx.set({ "Content-Type":"text/plain" })
    ctx.body = 'Your browser sent a request that this server could not understand.'
    return 
  }

  try {
    await getFile()

    // response headers设置
    resHeaders['Expires'] = moment().add(1, 'years').format('ddd, DD MMM YYYY HH:mm:ss GMT')
    resHeaders['Cache-Control'] = 'max-age=315360000'
    resHeaders['Last-Modified'] = moment(lastModifiedTime).format('ddd, DD MMM YYYY HH:mm:ss GMT')
    resHeaders['Content-Type'] = Object.values(filesExt)[0];
    resHeaders['Access-Control-Allow-Origin'] = '*';
    // 拼装文件
    resBody = filesContent.join('\n');
    
    ctx.status = 200
    ctx.set(resHeaders)
    ctx.body = resBody
  } catch(e) {
    ctx.status = 400
    ctx.set({ "Content-Type":"text/plain" })
    ctx.body = 'file not found.'
  }
});

// don't forget to export!
module.exports = app;