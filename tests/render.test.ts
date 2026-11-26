import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Dashboard from '../components/dashboard';
import Workspace from '../components/workspace';

test('the map renders valid title text without React server-render warnings', context=>{
  const errors:unknown[][]=[];
  context.mock.method(console,'error',(...args:unknown[])=>{errors.push(args);});
  const html=renderToStaticMarkup(createElement(Dashboard));
  assert.equal(errors.length,0);
  assert.ok(html.includes('<title>Midtown Center · Manhattan</title>'));
  assert.ok(!html.includes('Forecast taxi zone'));
});
test('private workspace initially renders a sign-in boundary without leaking data',context=>{
 const errors:unknown[][]=[];context.mock.method(console,'error',(...args:unknown[])=>errors.push(args));
 const html=renderToStaticMarkup(createElement(Workspace));
 assert.equal(errors.length,0);assert.ok(html.includes('Sign in to your account'));assert.ok(!html.includes('Your knowledge'));
});
