var fs = require('fs');
var request = require('request');
var zaif = require('zaif.jp');


var config = JSON.parse(fs.readFileSync('./config.json'));
var apiPri = zaif.createPrivateApi(config.apikey, config.secretkey, 'user agent is node-zaif');
var apiPub = zaif.PublicApi;

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

class CCList{
  pairs: any
  constructor(){}

  // zaifで現在扱っている通貨ペアのリストを取得してコールバックを呼ぶ
  load(callback): void{
    request.get({uri: "https://api.zaif.jp/api/1/currency_pairs/all"},
      function(error, response, body){
        // 通貨ペア一覧からJPYのものだけを取り出す
        this.pairs = JSON.parse(body).filter((element) => {
          return element.currency_pair.match("jpy");
        });

        // for(let pair of this.pairs){
        //   console.log(pair);
        // }
        callback();
    }.bind(this));
  }
}


// function currencies_all(){
//   request.get({uri: "https://api.zaif.jp/api/1/currency_pairs/all"},
//     function(error, response, body){
//     console.log(JSON.parse(body));
//     // console.log(body);
//   });
// }

check();
// notify2ifttt();
// currencies_all();

var cl:CCList = new CCList();
cl.load(function(){
  // 各通貨に対して価格を取得して、自分のDBに記録する
  for(let c of cl.pairs){
    // 本当はdepthを見てスプレッドを見た方がいい
    request.get({uri: "https://api.zaif.jp/api/1/last_price/" + c.currency_pair},
      (error, response, body) =>{
        console.log(c.currency_pair, ":", JSON.parse(body).last_price);
      });
  }

  // console.log(this.pairs);
}.bind(cl))
