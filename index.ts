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

class CCWatch{
  readonly interval = 60 * 1000; // 監視タイム

  pairs: any
  constructor(){}

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

        // 監視スタート
        this.watch();
    });
  }

  // 価格情報の1レコードのjsonを作る
  makeRecord(pair, time, price): object{
    // date, currency_pair, price
    return {c: pair, d: time, p: price};
  }

  // 現在価格を取得して場合によっては取引する
  update(): void{
    for(let c of this.pairs){
      // 1. 価格を取得する
      // 本当はdepthを見てスプレッドを見た方がいい
      request.get({uri: "https://api.zaif.jp/api/1/last_price/" + c.currency_pair},
        (error, response, body) =>{
          // 2. 自分のDBに記録する
          const now    = new Date();
          const price  = JSON.parse(body).last_price;
          const record = this.makeRecord(c.currency_pair, now.getTime(), price);

          console.log(dateFormat(now), c.currency_pair, ":", price);
          db.insert(record, (err) => {
            // 既存記録とレコードとまとめる
            const query = {pair: c.currency_pair, date: now};
            db.find(query, (err, docs) => {
              // エージェントに対して
              const agents = [];
              for(let agent of agents){
                // 3. 移動平均を作る

                // 4. 判断を入れる (買ってない場合->買うか何もしないか、買っている場合->買い増すか売るか何もしないか)

                // 5. 通知を入れる

              }
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
