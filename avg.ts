// リンクリスト
// そのままイテレータとして使いやすいようにあえて両端にemptyなLinkは持たない
// for文で回すときは返って使いづらいが…
export class Link{
  item:any;
  next:Link;
  prev:Link;
  constructor(item:any){
    this.item = item;
    this.next = null;
    this.prev = null;
  }

  // 自分の後ろに要素をつないで、後ろの要素を返す
  connect(nextItem:Link): Link{
    this.next = nextItem;
    nextItem.prev = this;
    return nextItem;
  }

  // 自分の手前の接続を切って、手前の要素を返す
  disconnect(): Link{
    let ret = null;
    if(this.prev != null){
      ret = this.prev;
      this.prev.next = null;
      this.prev = null;
    }
    return ret;
  }

  static fromArray(items:any[]): Link{
    if (items.length >= 1){
      let ret = new Link(items[0]);
      let ptr = ret;
      for(let i=1; i<items.length; ++i){
        ptr = ptr.connect(new Link(items[i]));
      }
      return ret;
    } else {
      return null;
    }
  }

  static concat(a:Link, b:Link): Link{
    for(let endA = a; endA != null; endA = endA.next){
      if(endA.next == null){
        endA.connect(b);
        return a;
      }
    }
    return null;
  }
}

// ask/bidそれぞれの各時刻から過去に遡って移動平均を計算する
// 一度計算しておけば複数のエージェントのシミュレーション取引で使いまわせる
export class Average{
  askAvgs:number[];
  askPtr:Link;

  bidAvgs:number[];
  bidPtr:Link;

  // 新しい順に接続されている価格履歴リスト過去方向への移動平均価格を返せるオブジェクトを生成する
  constructor(private priceLink:Link){
    this.askAvgs = [priceLink.item.ask];
    this.askPtr = priceLink.next;

    this.bidAvgs = [priceLink.item.bid];
    this.bidPtr = priceLink.next;
  }

  // 時刻-tから過去にn個分のaskの移動平均価格を返す(n>=1)
  getAskAvg(n:number): number{
    for(let i=this.askAvgs.length; i<n; ++i){
      if (this.askPtr == null) return this.askAvgs[this.askAvgs.length-1];
      this.askAvgs.push((this.askAvgs[i-1] * i + this.askPtr.item.ask) / (i+1));
      this.askPtr = this.askPtr.next;
    }
    return this.askAvgs[n>1 ? n-1 : 0];
  }

  // 時刻-tから過去にn個分のbidの移動平均価格を返す(n>=1)
  getBidAvg(n:number): number{
    for(let i=this.bidAvgs.length; i<n; ++i){
      if (this.bidPtr == null) return this.bidAvgs[this.bidAvgs.length-1];
      this.bidAvgs.push((this.bidAvgs[i-1] * i + this.bidPtr.item.bid) / (i+1));
      this.bidPtr = this.bidPtr.next;
    }
    return this.bidAvgs[n>1 ? n-1 : 0];
  }
}

////////////////////////////////////////////////////////////////////////////////

var assert = require('assert');
import * as mocha from "mocha";

describe('avg', function () {
    it('test for Link class', function(){
      var l = new Link({"hoge": 1, "foo": 2})
      var end = l.connect(new Link({"hoge": 3, "foo": 4})).connect(new Link({"hoge": 5, "foo": 6}))

      for(var x = l; x != null; x = x.next){
        // console.log(x.item);
      }

      end = end.disconnect();
      assert.equal(3, end.item.hoge); assert.equal(4, end.item.foo);

      end = end.disconnect();
      assert.equal(1, end.item.hoge); assert.equal(2, end.item.foo);

      end = end.disconnect();
      assert.equal(null, end);
    });

    it('test for Link::fromArray', function(){
      let l = Link.fromArray([1,2,3,4,5]);
      assert.equal(2, l.next.next.prev.item);
    })

    it('test for Link::concat', function(){
      let l1 = Link.fromArray([1,2]);
      let l2 = Link.fromArray([3,4,5]);
      let l  = Link.concat(l1, l2);
      assert.equal(3, l.next.next.item);
      assert.equal(4, l.next.next.next.item);
    })

    it('test for Average class', function(){
      var prices = Link.fromArray([
        {"ask":200, "bid":100},
        {"ask":210, "bid":140},
        {"ask":205, "bid":130},
        {"ask":225, "bid":160},
        {"ask":235, "bid":130},
        {"ask":205, "bid":140}
      ]);
      var avg = new Average(prices);
      assert.equal(200, avg.getAskAvg(1));
      assert.equal((200 + 210 + 205 + 225) / 4, avg.getAskAvg(4));

      assert.equal((100 + 140) / 2, avg.getBidAvg(2));
      assert.equal((100 + 140 + 130 + 160 + 130 + 140) / 6, avg.getBidAvg(6));
      assert.equal(avg.getBidAvg(6), avg.getBidAvg(7));

      var avg2 = new Average(prices.next);
      assert.equal(210, avg2.getAskAvg(1));
      assert.equal((210 + 205) / 2, avg2.getAskAvg(2));
    });
});
