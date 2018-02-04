import {PriceDB}       from "./price";
import {Agent}         from "./agent";


var fs     = require('fs');

////////////////////////////////////////////////////////////////////////////////

let config   = JSON.parse(fs.readFileSync('./config.json'));
let mongoUrl = `mongodb://${config.mongo_url}:${config.mongo_port}/`;

let pairs = [
  "bch_jpy",
  "bitcrystals_jpy",
  "btc_jpy",
  "cicc_jpy",
  "erc20.cms_jpy",
  "eth_jpy",
  "fscc_jpy",
  "jpyz_jpy",
  "mona_jpy",
  "mosaic.cms_jpy",
  "ncxc_jpy",
  "pepecash_jpy",
  "sjcx_jpy",
  "xcp_jpy",
  "xem_jpy",
  "zaif_jpy",
]

function getPriceStat(pairstr:string){
  let priceDB = new PriceDB(mongoUrl, config.mongo_dbname, pairstr);
  let latest;
  let count;

  return priceDB.connect()
    .then(() => {
      return priceDB.fetch(pairstr, 1000);
      // return priceDB.collection.find().limit(1000).sort({date: -1}).toArray();
    })
    .then((records) => {
      // console.log(records);
      latest = priceDB.latest()
      count  = priceDB.avgs.length;
      console.log(`${pairstr}\t${JSON.stringify(latest)}\t${count}`);
    });
}

function getParameterStat(pairstr:string){
  let paramDB = new Agent.ParamDB(mongoUrl, config.mongo_dbname, pairstr);
  let latest;
  let count;

  return paramDB.connect()
    .then(() => {
      return paramDB.find();
    })
    .then((params) => {
      console.log(`${pairstr}\tparam#1 ${JSON.stringify(params[0])}`);
      console.log(`${pairstr}\tparam#2 ${JSON.stringify(params[1])}`);
    });
}

for(let pairstr of pairs){
  getPriceStat(pairstr)
  .then(() => {
    getParameterStat(pairstr);
  })
}
