var request   = require('request');
var decimal   = require('decimal');

export namespace Util{
  export const DAYS4SCORING:number = 7; // 何日前までの取引履歴を成績として使うか
  export const AMOUNT:number = 10000; // 一度の取引で買う日本円金額

  export function dateFormat(now){
    const Y = now.getFullYear();
    const M = now.getMonth() + 1;
    const D = now.getDate();
    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();
    return Y + "/" + M + "/" + D + " " + h + ":" + m + ":" + s;
  }

  export function datelog(){
    return dateFormat(new Date())
  }

  // IFTTT経由でスマホに通知する
  export function notify2ifttt(message:string, key:string){
    var options = {
      uri: "https://maker.ifttt.com/trigger/cc/with/key/" + key,
      headers: {
        "Content-type": "application/json",
      },
      json: {
        "value1": message,
        // "value2": "b"
      }
    };
    request.post(options, function(error, response, body){});
  }

  // promiseパターンでhttp getする
  export function promiseRequestGet(uri:string){
    return new Promise(function(resolve, reject){
      request.get({uri: uri}, (error, response, body) =>{
        if (error == null) {
          // if (response.statusCode != 200){
          //   console.log(error, response);
          // }
          resolve(body);
        } else {
          reject(error);
        }
        // if (!error && response.statusCode == 200) {
        //   resolve(body);
        // } else {
        //   reject(error);
        // }
      });
    });
  }

  // ask円の通貨を、yen円内で最大でいくつ買えるかを計算する
  // 購入する通貨最小値, 通貨入力単位による制限がある
  export function calcAmount(ask:number, yen:number, unitMin:number, unitStep:number):number{
    // (unitMin + unitStep * N)*ask <= yen を満たす最大のNを求め、unitMinとの和を返す
    if (yen/ask - unitMin > 0){
      let N:number = Math.floor((yen/ask - unitMin) / unitStep);
      // 普通に計算するとunitStep * N + unitMinで小数点誤差が乗るのでdecimalライブラリ経由で算出する
      return decimal(unitStep).mul(N).add(unitMin).toNumber();
    } else {
      return 0;
    }
  }

  // 誤差によって微小のずれがでている数字を、unitMinの整数倍になるように補正する
  export function fixupFloat(value:number, unitStep:number):number{
    if(unitStep >= 1){
      return Math.round(value / unitStep) * unitStep;
    }else{
      return parseFloat(value.toFixed(Math.ceil(- Math.log10(unitStep))))
    }
  }

} // namespace
