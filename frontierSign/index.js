const path = require('path');
const vm_data = require(path.join(__dirname, '..', 'extracted_vm.json'));

let frontierSignFn = null;
let getRefererFn = null;

function buildVM() {
  if (typeof globalThis !== 'undefined') {
    globalThis.self = globalThis;
    globalThis.window = globalThis;
    if (!globalThis.document) {
      globalThis.document = {
        cookie: '', title: '', URL: 'https://www.tiktok.com/', readyState: 'complete',
        createElement: () => ({}), addEventListener: () => {}, removeEventListener: () => {},
        getElementById: () => null, getElementsByTagName: () => [], querySelector: () => null,
      };
    }
    if (!globalThis.navigator) {
      globalThis.navigator = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        platform: 'Win32', language: 'en-US', cookieEnabled: true,
      };
    }
  }

  const genCode = `
    var a = typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : Function('return this')();
    var f = 37;
    var e = "g0gFhMq6sDVJg[f$J";
    var i = 'session';
    var process;
    function n(t){return n="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(n){return typeof n}:function(n){return n&&"function"==typeof Symbol&&n.constructor===Symbol&&n!==Symbol.prototype?"symbol":typeof n},n(t)}
    var d = typeof TextDecoder !== 'undefined' ? TextDecoder : function(){this.decode=function(n){return n&&String.fromCharCode.apply(null,n)}};
    function l(n,t){n=new d("utf-8").decode(B(n));for(var r="",i=0;i<n.length;i++)r+=String.fromCharCode(n.charCodeAt(i)^t.charCodeAt(i%t.length));return r}

    var w = arguments[0].w;
    var g = arguments[0].g;
    var A = arguments[0].A;

    ${Object.entries(vm_data.helpers).map(([name, src]) => {
      return 'var ' + name + ' = ' + src;
    }).join(';\n    ')}

    var B_original = B;
    B = function(n,t) {
      if (n === undefined || n === null) return new Uint8Array(0);
      return B_original(n,t);
    };

    var v = {};
    var h = v;
    var s = [];

    ${vm_data.s.map((src, i) => {
      return 's[' + i + '] = ' + src;
    }).join(';\n    ')}

    try {
      S(0, void 0, a, [], 0, 14);
      return { success: true };
    } catch(e) {
      return { success: false, error: e.message };
    }
  `;

  const factory = new Function(genCode);
  const result = factory({ w: vm_data.w, g: vm_data.g, A: vm_data.A });

  if (!result.success) {
    throw new Error('VM bootstrap error: ' + result.error);
  }
  if (typeof globalThis.byted_acrawler !== 'object' || typeof globalThis.byted_acrawler.frontierSign !== 'function') {
    throw new Error('VM bootstrapped but frontierSign not found');
  }
  return globalThis.byted_acrawler;
}

function init() {
  if (!frontierSignFn) {
    const acrawler = buildVM();
    frontierSignFn = acrawler.frontierSign;
    getRefererFn = acrawler.getReferer;
  }
  return { frontierSign: frontierSignFn, getReferer: getRefererFn };
}

function frontierSign(params) {
  if (!frontierSignFn) init();
  return frontierSignFn(params);
}

function getReferer(params) {
  if (!getRefererFn) init();
  return getRefererFn(params);
}

module.exports = frontierSign;
module.exports.init = init;
module.exports.getReferer = getReferer;
