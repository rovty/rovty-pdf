import test from 'node:test';
import assert from 'node:assert/strict';
import { fullQuad, orderQuad, validQuad, scanPageLayout } from '../src/lib/scannerTypes';
test('scan crop accepts clockwise perspective corners and rejects crossed, tiny and invalid crops', () => {
  const quad = orderQuad([
    { x: 0.8, y: 0.9 },
    { x: 0.1, y: 0.8 },
    { x: 0.2, y: 0.1 },
    { x: 0.9, y: 0.2 },
  ]);
  assert.deepEqual(quad[0], { x: 0.2, y: 0.1 });
  assert.ok(validQuad(quad));
  assert.ok(validQuad(fullQuad()));
  assert.equal(validQuad([quad[0], quad[2], quad[1], quad[3]]), false);
  assert.equal(
    validQuad([
      { x: 0, y: 0 },
      { x: 0.01, y: 0 },
      { x: 0.01, y: 0.01 },
      { x: 0, y: 0.01 },
    ]),
    false,
  );
  assert.equal(validQuad([{ x: NaN, y: 0 }, ...fullQuad().slice(1)] as typeof quad), false);
});
test('scan page layout preserves receipts and never stretches landscape or portrait images', () => {
  const receipt = scanPageLayout(500, 4000, { paper: 'fit', margin: 18 });
  assert.equal(receipt.width / receipt.height, 1 / 8);
  assert.equal(receipt.x, 0);
  for (const size of [
    [2000, 3000],
    [3000, 1000],
  ]) {
    const layout = scanPageLayout(size[0], size[1], { paper: 'a4', margin: 18 });
    assert.equal(layout.drawnWidth / layout.drawnHeight, size[0] / size[1]);
    assert.ok(layout.x >= 17.99 && layout.y >= 17.99);
    assert.ok(layout.drawnWidth <= layout.width - 35.99);
    assert.ok(layout.drawnHeight <= layout.height - 35.99);
  }
});

test('scanner chooses the standard rear lens, excludes selfie and ultrawide, and resets zoom', async () => {
  const { standardRearCameras, openScanCamera } = await import('../src/lib/scanCameraDevice');
  const devices = [
    { deviceId: 'front', label: 'Front Camera', kind: 'videoinput' },
    { deviceId: 'ultra', label: 'Back Ultra Wide Camera', kind: 'videoinput' },
    { deviceId: 'dual', label: 'Back Dual Wide Camera', kind: 'videoinput' },
    { deviceId: 'normal', label: 'Back Wide Angle Camera', kind: 'videoinput' },
    { deviceId: 'tele', label: 'Back Telephoto Camera', kind: 'videoinput' },
  ] as MediaDeviceInfo[];
  assert.deepEqual(
    standardRearCameras(devices).map((d) => d.deviceId),
    ['normal', 'dual'],
  );
  const requests: MediaStreamConstraints[] = [];
  const stopped: string[] = [];
  const zoom: MediaTrackConstraints[] = [];
  const media = {
    enumerateDevices: async () => devices,
    getUserMedia: async (request: MediaStreamConstraints) => {
      requests.push(request);
      const id =
        ((request.video as MediaTrackConstraints).deviceId as ConstrainDOMStringParameters)
          ?.exact || 'ultra';
      const track = {
        label: devices.find((d) => d.deviceId === id)!.label,
        getSettings: () => ({ deviceId: id, facingMode: 'environment' }),
        getCapabilities: () => ({ zoom: { min: 1, max: 8 } }),
        applyConstraints: async (settings: MediaTrackConstraints) => {
          zoom.push(settings);
        },
        stop: () => stopped.push(String(id)),
      };
      return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    },
  };
  const result = await openScanCamera(media, true, new AbortController().signal);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.audio, false);
    assert.deepEqual((request.video as MediaTrackConstraints).facingMode, { exact: 'environment' });
  }
  assert.deepEqual(stopped, ['ultra']);
  assert.deepEqual(zoom, [{ advanced: [{ zoom: 1 }] }]);
  assert.equal(result.stream.getVideoTracks()[0].getSettings().deviceId, 'normal');
});

test('mobile camera never falls back to a front camera when rear access fails', async () => {
  const { openScanCamera } = await import('../src/lib/scanCameraDevice');
  let calls = 0;
  await assert.rejects(
    openScanCamera(
      {
        getUserMedia: async () => {
          calls++;
          throw new DOMException('No rear camera', 'OverconstrainedError');
        },
        enumerateDevices: async () => [],
      },
      true,
      new AbortController().signal,
    ),
    { name: 'OverconstrainedError' },
  );
  assert.equal(calls, 1);
});

test('leaving the camera stops its stream even while camera enumeration is pending', async () => {
  const { openScanCamera } = await import('../src/lib/scanCameraDevice');
  let resolveDevices!: (devices: MediaDeviceInfo[]) => void;
  let stopped = false;
  const track = {
    stop: () => {
      stopped = true;
    },
  };
  const controller = new AbortController();
  const result = openScanCamera(
    {
      getUserMedia: async () => ({ getTracks: () => [track] }) as unknown as MediaStream,
      enumerateDevices: () =>
        new Promise((resolve) => {
          resolveDevices = resolve;
        }),
    },
    true,
    controller.signal,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  assert.equal(stopped, true);
  resolveDevices([]);
  await assert.rejects(result, { name: 'AbortError' });
});
