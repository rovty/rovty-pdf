type CameraDevice = Pick<MediaDeviceInfo, 'deviceId' | 'label' | 'kind'>;
const front = /front|user\b|selfie|facetime/i;
const rear = /back|rear|environment|facing\s*back/i;
// A phone's ordinary 1× lens may be named “Wide Angle”. Ultra Wide is the 0.5× lens.
const alternateLens = /ultra[\s-]*wide|0[.,]5\s*[x×]?|telephoto|tele\b|fisheye/i;
const combinedLens = /dual|triple|fusion|virtual/i;
export function standardRearCameras<T extends CameraDevice>(devices: T[]): T[] {
  return devices
    .filter(
      (d) =>
        d.kind === 'videoinput' &&
        rear.test(d.label) &&
        !front.test(d.label) &&
        !alternateLens.test(d.label),
    )
    .sort((a, b) => Number(combinedLens.test(a.label)) - Number(combinedLens.test(b.label)));
}
export function isMobileCamera() {
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
export async function openScanCamera(
  media: Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>,
  mobile: boolean,
  signal: AbortSignal,
  deviceId?: string,
) {
  let stream: MediaStream | undefined;
  const stop = () => stream?.getTracks().forEach((track) => track.stop());
  signal.addEventListener('abort', stop, { once: true });
  const check = () => {
    if (signal.aborted) {
      stop();
      signal.throwIfAborted();
    }
  };
  const open = async (id?: string) => {
    stream = await media.getUserMedia({
      audio: false,
      video: {
        facingMode: mobile ? { exact: 'environment' } : { ideal: 'environment' },
        ...(id ? { deviceId: { exact: id } } : {}),
        width: { ideal: 2560 },
        height: { ideal: 1920 },
      },
    });
    check();
    return stream;
  };
  try {
    check();
    await open(deviceId);
    const devices = await media.enumerateDevices().catch(() => []);
    check();
    const backCameras = standardRearCameras(devices);
    const preferred = !deviceId && backCameras[0];
    if (preferred && preferred.deviceId !== stream!.getVideoTracks()[0].getSettings().deviceId) {
      stop();
      await open(preferred.deviceId);
    }
    const track = stream!.getVideoTracks()[0];
    if (
      mobile &&
      (track.getSettings().facingMode === 'user' ||
        front.test(track.label) ||
        alternateLens.test(track.label))
    ) {
      throw new Error(
        'A standard rear camera is not available here. Take a photo with your phone camera and import it.',
      );
    }
    const caps = track.getCapabilities?.() as
      (MediaTrackCapabilities & { zoom?: { min: number; max: number } }) | undefined;
    if (caps?.zoom) {
      const zoom = Math.max(caps.zoom.min, Math.min(1, caps.zoom.max));
      await track
        .applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] })
        .catch(() => {});
      check();
    }
    return {
      stream: stream!,
      cameras: mobile
        ? backCameras
        : devices.filter((d) => d.kind === 'videoinput' && !alternateLens.test(d.label)),
    };
  } catch (error) {
    stop();
    throw error;
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
