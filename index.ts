var fs        = require('fs');
var request   = require('request');
var zaif      = require('zaif.jp');
var Datastore = require('nedb');

function dateFormat(now){
  const Y = now.getFullYear();
  const M = now.getMonth() + 1;
  const D = now.getDate();
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();
  return Y + "/" + M + "/" + D + " " + h + ":" + m + ":" + s;
}

// zaifに接続する
var config = JSON.parse(fs.readFileSync('./config.json'));
var apiPri = zaif.createPrivateApi(config.apikey, config.secretkey, 'user agent is node-zaif');
var apiPub = zaif.PublicApi;

// ローカルのdbを開く
var db = new Datastore({filename: 'data/database.db', autoload: true});


function check(){
  console.log(apiPub);
  console.log(apiPri);
}

// apiPub.depth('mona_jpy').then(function(res){
//   console.log(res);
// });


function getStatus(){
  apiPri.getInfo().then(function(res){
      console.log(res)
  });
}

function notify2ifttt(){
  var options = {
    uri: "https://maker.ifttt.com/trigger/cc/with/key/" + config.ifttt,
    headers: {
      "Content-type": "application/json",
    },
    json: {
      "value1": "a",
      "value2": "b"
    }
  };
  request.post(options, function(error, response, body){});
}

// 自分のパラメータに基づいて判断をして売り買いを実行する
// (買ってない場合->買うか何もしないか、買っている場合->買い増すか売るか何もしないか)
// 移動平均など売り買いに必要な判断をつける
// 判断に基づいて売り買いを実行する
// 通知を入れる
class Agent{
  average_price: Number; // 買い付けている時の買い付け価格

  constructor(){
    this.average_price = 0;
  }

  // 今買っているかどうか
  has(): Boolean{
    return this.average_price > 0;
  }

  // 新しい価格リストを受け取って、売り買いの判断をつける
  update(records): void{
    const latest = records.reduce((x, y) => { return x.d > y.d ? x : y});
    if (this.has()){
      // 買っている場合->買い増すか売るか何もしないか)
      const sell:Boolean = true
      if (sell){
        // 成行で売る=bidの価格で売ったことにする
        console.log("Sell:", latest.p, "for", latest.b, "yen from", this.average_price, "yen");
        this.average_price = 0;
      }
    } else {
      // 買ってない場合->買うか何もしないか
      const buy:Boolean = true
      if (buy){
        this.average_price = latest.a // 成行で買う=askの価格で買ったことにする
        console.log("Buy:", latest.p, "for", this.average_price, "yen");
      }
    }
  }
}

// 上のAgentを設定違いで複数個もって取引をシミュレートし、最適なものを実際の取引に使う
class Agents{
  active_index: number; // nullable
  agents: Agent[];

  constructor(){
    this.active_index = null;
    this.agents = [new Agent()];
  }

  has(): Boolean{
    return (this.active_index != null) && this.agents[this.active_index].has();
  }

  update(records): void{
    for(let agent of this.agents){
      agent.update(records);
    }
  }
}

class CCWatch{
  readonly interval = 60 * 1000; // 監視タイム

  pairs: any;
  agents: { [key: string]: Agents};
  constructor(){
    this.agents = {};
  }

  // zaifで現在扱っている通貨ペアのリストを取得してコールバックを呼ぶ
  start(): void{
    request.get({uri: "https://api.zaif.jp/api/1/currency_pairs/all"},
      (error, response, body) => {
        // 通貨ペア一覧からJPYのものだけを取り出す
        // "公開情報APIのcurrency_pairsで取得できるevent_numberが0であるものが指定できます" とのことなので
        // それもフィルタリングする
        this.pairs = JSON.parse(body).filter((element) => {
          const isJpy    = element.currency_pair.match("jpy");
          const isActive = element.event_number == 0;
          return isJpy && isActive;
        });

        // 見つかった通貨ペアごとにエージェントを用意する
        for(let pair of this.pairs){
          let pairstr: string = pair.currency_pair;
          if(! (pairstr in this.agents)){
            this.agents[pairstr] = new Agents();
          }
        }

        // 監視スタート
        this.watch();
    });
  }

  // 価格情報の1レコードのjsonを作る
  makeRecord(pair, time, ticker): object{
    // date, currency_pair, ask: bit
    return {d: time, p: pair, a: ticker.ask, b: ticker.bid};
  }

  // 現在価格を取得して場合によっては取引する
  update(): void{
    for(let pair of this.pairs){
      let pairstr: string = pair.currency_pair;
      // 1. 価格を取得する
      // 本当はdepthを見てスプレッドを見た方がいい
      request.get({uri: "https://api.zaif.jp/api/1/ticker/" + pairstr},
        (error, response, body) =>{
          const ticker = JSON.parse(body);

          // 2. 自分のDBに記録する
          const now    = new Date();
          const price  = JSON.parse(body).last_price;
          const record = this.makeRecord(pairstr, now.getTime(), ticker);

          console.log(dateFormat(now), pairstr, ": ask=" + ticker.ask, ", bid=" + ticker.bid);
          db.insert(record, (err) => {
            // 既存記録とレコードとまとめる
            const query = {p: pairstr};
            db.find(query, (err, records) => {
              // 各エージェントに判断を仰ぐ
              this.agents[pairstr].update(records);
            });
          });
        });
    }
  }

  // 定期的に実行
  watch(): void{
    this.update()
    setInterval(() => {this.update()}, this.interval);
  }
}


check();
// notify2ifttt();
// currencies_all();

var ccw:CCWatch = new CCWatch();

ccw.start();
