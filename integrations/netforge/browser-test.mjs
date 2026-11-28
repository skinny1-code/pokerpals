import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true});
try {
 const c1=await browser.newContext(),c2=await browser.newContext();
 const p1=await c1.newPage(),p2=await c2.newPage();
 const errors=[];
 for(const p of [p1,p2])p.on("pageerror",e=>errors.push(e.message));
 await p1.goto("http://127.0.0.1:4663/?server=http%3A%2F%2F127.0.0.1%3A4663");
 await p1.waitForSelector("#table .seat",{timeout:30000});
 await p2.goto(p1.url());
 for(const p of [p1,p2])await p.waitForFunction(()=>document.querySelector("#table")?.textContent?.includes("PREFLOP"),{},{timeout:30000});
 for(const p of [p1,p2])assert.equal(await p.locator(".seat").first().locator(".card.back").count(),2);
 for(let i=0;i<8;i++){
  const rev=await p1.locator("#app").getAttribute("data-rev");
  await p2.waitForFunction(rev=>document.querySelector("#app")?.getAttribute("data-rev")===rev,rev,{timeout:10000});
  const active=(await p1.locator("#notice").innerText()).startsWith("Your turn")?p1:p2;
  assert.match(await active.locator("#notice").innerText(),/Your turn/);
  await active.locator('button[data-act="2"]').click();
  for(const p of [p1,p2])await p.waitForFunction(rev=>document.querySelector("#app")?.getAttribute("data-rev")!==rev,rev,{timeout:10000});
 }
 for(const p of [p1,p2]){await p.waitForFunction(()=>document.querySelector("#table")?.textContent?.includes("RESULT"),{},{timeout:10000});assert.equal(await p.locator(".felt .card").count(),5);assert.equal(await p.locator(".seat .card.back").count(),0);}
 assert.deepEqual(errors,[]);
 console.log("PASS: two isolated browser clients, private hole cards, all streets, showdown");
} finally {await browser.close();}
