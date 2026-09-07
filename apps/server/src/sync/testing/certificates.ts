import { createHash, generateKeyPairSync, sign } from 'node:crypto';

/**
 * Material TLS efímero para las pruebas de transporte de 10.03/10.04. Genera
 * certificados autofirmados en memoria para no versionar claves privadas y para
 * ejercitar autenticación mutua real en lugar de simularla.
 *
 * No forma parte de la provisión de producción: la emisión, renovación y
 * revocación reales se administran fuera del proceso y solo su huella llega al
 * registro confiable de nodos.
 */
export type NodeCertificate = {
  readonly commonName: string;
  readonly privateKeyPem: string;
  readonly certificatePem: string;
  /** Huella SHA-256 en hexadecimal minúsculo, como la almacena el registro. */
  readonly fingerprint: string;
};

const length = (size: number): Buffer => {
  if (size < 0x80) return Buffer.from([size]);
  const bytes: number[] = [];
  let remaining = size;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};

const tagged = (tag: number, content: Buffer): Buffer =>
  Buffer.concat([Buffer.from([tag]), length(content.length), content]);

const sequence = (...parts: Buffer[]): Buffer => tagged(0x30, Buffer.concat(parts));
const set = (content: Buffer): Buffer => tagged(0x31, content);
const bitString = (content: Buffer): Buffer =>
  tagged(0x03, Buffer.concat([Buffer.from([0]), content]));
const octetString = (content: Buffer): Buffer => tagged(0x04, content);
const explicit = (index: number, content: Buffer): Buffer => tagged(0xa0 | index, content);

const integer = (value: Buffer): Buffer =>
  tagged(0x02, (value[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value);

const objectIdentifier = (dotted: string): Buffer => {
  const parts = dotted.split('.').map(Number);
  const bytes = [(parts[0] as number) * 40 + (parts[1] as number)];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f];
    let remaining = part >> 7;
    while (remaining > 0) {
      chunk.unshift((remaining & 0x7f) | 0x80);
      remaining >>= 7;
    }
    bytes.push(...chunk);
  }
  return tagged(0x06, Buffer.from(bytes));
};

const utcTime = (value: Date): Buffer => {
  const text = value.toISOString().replace(/[-:T]/g, '').replace(/\.\d{3}Z$/, 'Z').slice(2);
  return tagged(0x17, Buffer.from(text, 'ascii'));
};

const commonNameOf = (commonName: string): Buffer => sequence(set(sequence(
  objectIdentifier('2.5.4.3'),
  tagged(0x0c, Buffer.from(commonName, 'utf8'))
)));

const extension = (oid: string, critical: boolean, value: Buffer): Buffer => sequence(
  objectIdentifier(oid),
  ...(critical ? [tagged(0x01, Buffer.from([0xff]))] : []),
  octetString(value)
);

const subjectAlternativeNames = sequence(
  tagged(0x82, Buffer.from('localhost', 'ascii')),
  tagged(0x87, Buffer.from([127, 0, 0, 1]))
);

const toPem = (der: Buffer): string => {
  const body = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
};

/**
 * Emite un certificado autofirmado de curva P-256 utilizable como cliente y
 * como servidor, con `localhost` y `127.0.0.1` en su SAN.
 */
export const issueNodeCertificate = (
  commonName: string,
  validity: { readonly notBefore: Date; readonly notAfter: Date } = {
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 3_600_000)
  }
): NodeCertificate => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const algorithm = sequence(objectIdentifier('1.2.840.10045.4.3.2'));
  const name = commonNameOf(commonName);
  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(createHash('sha256').update(commonName).digest().subarray(0, 8)),
    algorithm,
    name,
    sequence(utcTime(validity.notBefore), utcTime(validity.notAfter)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, sequence(
      extension('2.5.29.19', true, sequence(tagged(0x01, Buffer.from([0xff])))),
      extension('2.5.29.15', true, tagged(0x03, Buffer.from([0x02, 0x84]))),
      extension('2.5.29.37', false, sequence(
        objectIdentifier('1.3.6.1.5.5.7.3.1'),
        objectIdentifier('1.3.6.1.5.5.7.3.2')
      )),
      extension('2.5.29.17', false, subjectAlternativeNames)
    ))
  );
  const der = sequence(tbs, algorithm, bitString(sign('sha256', tbs, privateKey)));

  return {
    commonName,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    certificatePem: toPem(der),
    fingerprint: createHash('sha256').update(der).digest('hex')
  };
};
