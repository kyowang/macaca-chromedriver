'use strict';

const path = require('path');
const detect = require('detect-port');
const EventEmitter = require('events');
const childProcess = require('child_process');

const _ = require('./helper');
const logger = require('./logger');
const DriverProxy = require('./proxy');
const Install = require('./install');
const Versions = require('./versions');

// Deprecated
const fileName = _.platform.isWindows ? 'chromedriver' + Versions.defaultVersion + '.exe' : 'chromedriver' + Versions.defaultVersion;
// Deprecated
const binPath = path.join(__dirname, '..', 'exec', fileName);

const proxyPort = parseInt(process.env.MACACA_CHROMEDRIVER_PORT || 9515, 10);

class ChromeDriver extends EventEmitter {
  constructor(options) {
    super();
    Object.assign(this, {
      proxyHost: 'localhost',
      proxyPort: proxyPort,
      urlBase: 'wd/hub',
      webviewVersion: undefined
    }, options || {});
    this.versions = new Versions();
    this.version = this.getChromedriverVersion();
    this.binPath = this.getBinPath(this.version);
    this.proxy = null;
    this.chromedriver = null;
    this.capabilities = null;
    this.sessionId = null;
    this.init();
  }

  init() {
    this.checkBinPath();
    this.initPorxy();
  }

  checkBinPath() {
    if (_.isExistedFile(this.binPath)) {
      logger.info(`chromedriver bin path: ${this.binPath}`);
    } else {
      logger.warn(`chromedriver bin path (${this.binPath}) not found, try to download first!`);
      Install(this.version).then(() => {
        logger.info(`Install chromedriver version ${this.version} succeed!`);
      }).catch(() => {
        logger.error(`Install chromedriver version ${this.version} failed!`);
      });
    }
  }

  getChromedriverVersion() {
    if (process.env.WEBVIEW_VERSION) {
      return this.versions.getVersionFromWebviewVersion(process.env.WEBVIEW_VERSION);
    } else if (this.webviewVersion) {
      return this.versions.getVersionFromWebviewVersion(this.webviewVersion);
    } else if (process.env.CHROMEDRIVER_VERSION) {
      return process.env.CHROMEDRIVER_VERSION;
    } else {
      return this.versions.defaultVersion;
    }
  }

  initPorxy() {
    this.proxy = new DriverProxy({
      proxyHost: this.proxyHost,
      proxyPort: this.proxyPort,
      urlBase: this.urlBase
    });
  }

  waitReadyStatus() {
    logger.info('chromedriver starting success.');

    return _.retry(this.getStatus.bind(this), 1000, 20)
      .then(() => _.retry(this.createSession.bind(this), 1000, 20)
        .then(data => {
          this.emit(ChromeDriver.EVENT_READY, data);
        })
        .catch(err => {
          logger.debug(`create chromedriver session failed with: ${err}`);
        }))
      .catch(err => {
        logger.debug(`get chromedriver ready status failed with: ${err}`);
      });
  }

  sendCommand(url, method, body) {
    return this.proxy.send(url, method, body);
  }

  getStatus() {
    return this.sendCommand('/status', 'GET');
  }

  getBinPath(chromedriverVersion) {
    var fileName = _.platform.isWindows ? 'chromedriver' + chromedriverVersion + '.exe' : 'chromedriver' + chromedriverVersion;
    var binPath = path.join(__dirname, '..', 'exec', fileName);
    return binPath;
  }

  createSession() {
    return this.sendCommand('/session', 'POST', {
      desiredCapabilities: this.capabilities
    });
  }

  start(caps) {
    this.capabilities = caps;

    return this.starting()
      .then(this.waitReadyStatus.bind(this))
      .catch(err => {
        logger.warn('chromedriver starting failed.');
        setTimeout(function () {
          throw err;
        });
      });
  }

  starting() {
    return detect(this.proxyPort).then(port => {
      return new Promise((resolve, reject) => {
        this.proxy.proxyPort = this.proxyPort = port;
        let args = [`--url-base=${this.urlBase}`];
        args.push(`--port=${this.proxyPort}`);

        this.chromedriver = childProcess.spawn(this.binPath, args, {});

        this.chromedriver.stderr.setEncoding('utf8');
        this.chromedriver.stdout.setEncoding('utf8');

        var res = '';
        var startFlag = 'Starting';

        this.chromedriver.stdout.on('data', data => {
          res += data;
          logger.info(data);
          if (res.startsWith(startFlag)) {
            resolve('chromedriver start success!');
          } else if (res.length >= startFlag.length) {
            reject(new Error('chromedriver start failed.'));
          }
        });

        this.chromedriver.on('error', (err) => {
          this.emit(ChromeDriver.EVENT_ERROR, err);
          logger.warn(`chromedriver error with ${err}`);
          reject(err);
        });

        this.chromedriver.on('exit', (code, signal) => {
          logger.warn(`chromedriver exit with code: ${code}, signal: ${signal}`);
          reject(new Error(`chromedriver exit with code: ${code}, signal: ${signal}`));
        });
      });
    }).catch(err => {
      logger.info('kill all chromedriver process failed!');
      throw err;
    });
  }

  stop() {
    this.chromedriver && this.chromedriver.kill();
  }
}

ChromeDriver.start = () => {
  ChromeDriver.chromedriver = childProcess.execFile(binPath);
  return ChromeDriver.chromedriver;
};

ChromeDriver.stop = () => {
  if (ChromeDriver.chromedriver) {
    ChromeDriver.chromedriver.kill();
    logger.info('chromedriver killed');
  }
};

ChromeDriver.EVENT_READY = 'ready';
ChromeDriver.EVENT_ERROR = 'error';

//deprecated
ChromeDriver.binPath = binPath;
//deprecated
ChromeDriver.fileName = fileName;
//deprecated
ChromeDriver.version = process.env.CHROMEDRIVER_VERSION || Versions.defaultVersion;

module.exports = ChromeDriver;
