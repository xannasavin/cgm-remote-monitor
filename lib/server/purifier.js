'use strict';

const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

function init (_env, _ctx) {

  const purifier = {};

  function iterate (obj) {
    for (var property in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, property)) {
        if (typeof obj[property] == 'object')
          iterate(obj[property]);
        else
        if (isNaN(obj[property])) {
          const clean = DOMPurify.sanitize(obj[property]);
          if (obj[property] !== clean) {
            obj[property] = clean;
          }
        }
      }
    }
  }

  purifier.purifyObject = function purifyObject (obj) {
    return iterate(obj);
  }

  return purifier;

}

module.exports = init;
