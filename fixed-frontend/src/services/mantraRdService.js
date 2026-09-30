const RD_PORTS = Array.from({ length: 21 }, (_, index) => 11100 + index);
const RD_BASE_URLS = ["https", "http"].flatMap((protocol) =>
  RD_PORTS.map((port) => `${protocol}://127.0.0.1:${port}`)
);

const PID_OPTIONS = `<?xml version="1.0"?>
<PidOptions ver="1.0">
  <Opts fCount="1" fType="0" iCount="0" pCount="0" format="0" pidVer="2.0" timeout="15000" posh="UNKNOWN" env="P" wadh="" />
  <CustOpts><Param name="mantrakey" value="" /></CustOpts>
</PidOptions>`;

function callRdService(url, method, body = null, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url, true);
    request.timeout = timeout;
    request.setRequestHeader("Accept", "text/xml");
    if (body) {
      // Mantra's RD examples use XML and this legacy header spelling.
      request.setRequestHeader("Content-Type", "text/xml");
      request.setRequestHeader("ContentType", "text/xml");
    }
    request.onload = () => {
      if (request.status === 200 && request.responseText) {
        resolve(request.responseText);
      } else {
        reject(new Error(`RD service returned HTTP ${request.status || "an empty response"}`));
      }
    };
    request.onerror = () => reject(new Error("RD service could not be reached"));
    request.ontimeout = () => reject(new Error("RD service request timed out"));
    request.send(body);
  });
}

function parseXml(xml, description) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error(`The MFS110 returned an invalid ${description} response.`);
  }
  return document;
}

async function discoverRdService() {
  const results = await Promise.all(
    RD_BASE_URLS.map(async (baseUrl) => {
      try {
        const response = await callRdService(baseUrl, "RDSERVICE", null, 2500);
        const document = parseXml(response, "discovery");
        const service = document.querySelector("RDService");
        const capture = document.querySelector('Interface[id="CAPTURE"]');
        const info = document.querySelector('Interface[id="DEVICEINFO"]');
        if (service?.getAttribute("status") === "READY" && capture && info) {
          return { baseUrl, capturePath: capture.getAttribute("path"), infoPath: info.getAttribute("path") };
        }
      } catch {
        // Try the remaining documented localhost ports and protocols.
      }
      return null;
    })
  );
  const service = results.find(Boolean);
  if (!service) {
    throw new Error("MFS110 RD Service was not found. Connect the scanner and start its Mantra RD Service.");
  }
  return service;
}

export async function captureMfs110Fingerprint() {
  const { baseUrl, capturePath, infoPath } = await discoverRdService();
  const [deviceInfoXml, pidDataXml] = await Promise.all([
    callRdService(`${baseUrl}${infoPath}`, "DEVICEINFO"),
    callRdService(`${baseUrl}${capturePath}`, "CAPTURE", PID_OPTIONS, 20000),
  ]);

  const deviceInfo = parseXml(deviceInfoXml, "device information").querySelector("DeviceInfo");
  const pidDocument = parseXml(pidDataXml, "fingerprint capture");
  const response = pidDocument.querySelector("PidData > Resp");
  const capturedDevice = pidDocument.querySelector("PidData > DeviceInfo");
  const deviceModel = deviceInfo?.getAttribute("mi") || capturedDevice?.getAttribute("mi");
  const deviceId = deviceInfo?.getAttribute("dc") || capturedDevice?.getAttribute("dc");
  const errorCode = response?.getAttribute("errCode");

  if (errorCode !== "0") {
    throw new Error(response?.getAttribute("errInfo") || "The MFS110 could not capture a fingerprint. Please try again.");
  }
  if (!deviceModel || !/MFS110/i.test(deviceModel) || !deviceId) {
    throw new Error("The connected device is not a recognised Mantra MFS110 scanner.");
  }
  if (!["Skey", "Hmac", "Data"].every((element) => pidDocument.querySelector(`PidData > ${element}`))) {
    throw new Error("The MFS110 capture response is incomplete. Please scan again.");
  }

  const qualityAttribute = response.getAttribute("qScore");
  const quality = qualityAttribute === null ? null : Number(qualityAttribute);
  return {
    provider: "mantra_mfs110",
    pid_data: pidDataXml,
    device_id: deviceId,
    device_model: deviceModel,
    quality_score: Number.isFinite(quality) ? quality : null,
  };
}
