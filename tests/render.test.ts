import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Dashboard from '../components/dashboard';

test('the map renders valid title text without React server-render warnings', context=>{
  const errors:unknown[][]=[];
  context.mock.method(console,'error',(...args:unknown[])=>{errors.push(args);});
  const html=renderToStaticMarkup(createElement(Dashboard));
  assert.equal(errors.length,0);
  assert.ok(html.includes('<title>Midtown Center · Manhattan</title>'));
  assert.ok(!html.includes('Forecast taxi zone'));
});
