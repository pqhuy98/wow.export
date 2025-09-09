const axios = require('axios');

const restPort = process.env.WOWEXPORT_REST_PORT ? parseInt(process.env.WOWEXPORT_REST_PORT, 10) : 17752;
const baseURL = `http://127.0.0.1:${restPort}`;

const client = axios.create({
  baseURL,
  timeout: 30000,
  // Let tests assert on status codes themselves
  validateStatus: () => true,
  headers: { 'Content-Type': 'application/json' }
});

module.exports = { baseURL, client };


