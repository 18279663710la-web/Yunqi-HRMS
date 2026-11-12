import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTencentGeocode } from '../src/domains/attendance/geocodeService';

test('逆地址解析优先使用地图地点名称，并保留格式化地址', () => {
  const result = parseTencentGeocode({
    status: 0,
    result: {
      address: '广东省广州市天河区花城大道 85 号',
      formatted_addresses: { recommend: '珠江新城写字楼' },
      pois: [{ title: '广州云启科技有限公司' }],
    },
  });
  assert.deepEqual(result, {
    name: '广州云启科技有限公司',
    address: '广东省广州市天河区花城大道 85 号',
    resolved: true,
  });
});

test('逆地址解析无 POI 时回退推荐地址，失败时回退当前位置', () => {
  const recommended = parseTencentGeocode({
    status: 0,
    result: {
      address: '广东省广州市天河区花城大道 85 号',
      formatted_addresses: { recommend: '珠江新城写字楼' },
    },
  });
  assert.equal(recommended.name, '珠江新城写字楼');
  assert.equal(recommended.resolved, true);

  assert.deepEqual(parseTencentGeocode({ status: 199, message: 'key' }), {
    name: '当前位置',
    address: '当前位置',
    resolved: false,
  });
  assert.deepEqual(parseTencentGeocode({ status: 0, result: {} }), {
    name: '当前位置',
    address: '当前位置',
    resolved: false,
  });
});
