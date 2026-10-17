'use strict';
const fs = require('fs');
const path = require('path');

/** Store JSON semplice (sincrono, difensivo). */
class Store {
  constructor(dir, file = 'settings.json') {
    this.file = path.join(dir, file);
    this.data = {};
    this.load();
  }
  load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {};
    } catch (e) {
      this.data = {};
    }
    return this.data;
  }
  get(key, def = null) {
    return key in this.data ? this.data[key] : def;
  }
  set(key, value) {
    this.data[key] = value;
    this.save();
  }
  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('[store] salvataggio fallito:', e.message);
    }
  }
}

module.exports = { Store };
