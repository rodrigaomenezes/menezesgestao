// Áudio gravado no navegador → mensagem de voz do WhatsApp.
// O Chrome grava WebM com Opus; o WhatsApp quer Ogg com Opus. O som é o mesmo (Opus): aqui só trocamos a
// "embalagem" (remux), sem recodificar e sem depender de ffmpeg no servidor.

/** Lê um inteiro de tamanho variável do EBML. `marcador` = manter o bit de tamanho (ids) ou não (tamanhos). */
function lerVint(b: Buffer, pos: number, marcador: boolean): { valor: number; tamanho: number; desconhecido: boolean } {
  const primeiro = b[pos];
  if (primeiro === undefined || primeiro === 0) throw new Error("WebM inválido (inteiro variável).");
  let tamanho = 1;
  while (!(primeiro & (0x80 >> (tamanho - 1)))) tamanho++;
  let valor = marcador ? primeiro : primeiro & (0xff >> tamanho);
  let todosUm = valor === (0xff >> tamanho);
  for (let i = 1; i < tamanho; i++) {
    const byte = b[pos + i];
    if (byte === undefined) throw new Error("WebM truncado.");
    valor = valor * 256 + byte;
    if (byte !== 0xff) todosUm = false;
  }
  return { valor, tamanho, desconhecido: !marcador && todosUm };
}

const CONTEINERES = new Set([0x18538067 /* Segment */, 0x1f43b675 /* Cluster */, 0x1654ae6b /* Tracks */, 0xae /* TrackEntry */, 0xa0 /* BlockGroup */]);
const CODEC_PRIVATE = 0x63a2;
const CODEC_ID = 0x86;
const SIMPLE_BLOCK = 0xa3;
const BLOCK = 0xa1;

/** Extrai o cabeçalho Opus e os pacotes de áudio de um WebM (uma faixa de áudio, sem "lacing"). */
export function lerWebmOpus(webm: Buffer): { opusHead: Buffer; pacotes: Buffer[] } {
  if (webm.readUInt32BE(0) !== 0x1a45dfa3) throw new Error("O arquivo não é WebM.");
  let pos = 0;
  let opusHead: Buffer | null = null;
  let codec = "";
  const pacotes: Buffer[] = [];
  while (pos < webm.length) {
    const id = lerVint(webm, pos, true);
    const tam = lerVint(webm, pos + id.tamanho, false);
    const inicio = pos + id.tamanho + tam.tamanho;
    if (CONTEINERES.has(id.valor)) {
      pos = inicio; // entra no contêiner (funciona com tamanho desconhecido, como grava o navegador)
      continue;
    }
    if (tam.desconhecido) throw new Error("WebM com elemento de tamanho desconhecido fora de contêiner.");
    const fim = Math.min(webm.length, inicio + tam.valor);
    const dados = webm.subarray(inicio, fim);
    if (id.valor === CODEC_ID) codec = dados.toString("latin1");
    if (id.valor === CODEC_PRIVATE) opusHead = Buffer.from(dados);
    if (id.valor === SIMPLE_BLOCK || id.valor === BLOCK) {
      const faixa = lerVint(dados, 0, false);
      const flags = dados[faixa.tamanho + 2];
      if (flags === undefined) throw new Error("Bloco WebM truncado.");
      if (flags & 0x06) throw new Error("WebM com lacing não é suportado.");
      pacotes.push(Buffer.from(dados.subarray(faixa.tamanho + 3)));
    }
    pos = fim;
  }
  if (codec && codec !== "A_OPUS") throw new Error(`Áudio ${codec} não é Opus.`);
  if (!opusHead || opusHead.subarray(0, 8).toString("latin1") !== "OpusHead") throw new Error("WebM sem cabeçalho Opus.");
  if (!pacotes.length) throw new Error("WebM sem áudio.");
  return { opusHead, pacotes };
}

/** Amostras (a 48 kHz) de um pacote Opus, pelo byte TOC (RFC 6716, 3.1). */
export function amostrasOpus(pacote: Buffer): number {
  const toc = pacote[0];
  if (toc === undefined) return 0;
  const config = toc >> 3;
  const ms10 =
    config < 12 ? [100, 200, 400, 600][config % 4] : config < 16 ? [100, 200][config % 2] : [25, 50, 100, 200][config % 4]; // décimos de ms
  const c = toc & 0x03;
  const quadros = c === 0 ? 1 : c < 3 ? 2 : (pacote[1] ?? 0) & 0x3f;
  return (ms10 * 48 * quadros) / 10;
}

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

function crcOgg(b: Buffer): number {
  let crc = 0;
  for (const byte of b) crc = ((crc << 8) ^ (TABELA_CRC[((crc >>> 24) ^ byte) & 0xff] ?? 0)) >>> 0;
  return crc >>> 0;
}

function pagina(pacotes: Buffer[], granulo: bigint, serie: number, sequencia: number, tipo: number): Buffer {
  const segmentos: number[] = [];
  for (const p of pacotes) {
    let resto = p.length;
    while (resto >= 255) {
      segmentos.push(255);
      resto -= 255;
    }
    segmentos.push(resto);
  }
  const cabecalho = Buffer.alloc(27 + segmentos.length);
  cabecalho.write("OggS", 0, "latin1");
  cabecalho[4] = 0;
  cabecalho[5] = tipo;
  cabecalho.writeBigInt64LE(granulo, 6);
  cabecalho.writeUInt32LE(serie, 14);
  cabecalho.writeUInt32LE(sequencia, 18);
  cabecalho.writeUInt32LE(0, 22);
  cabecalho[26] = segmentos.length;
  segmentos.forEach((s, i) => (cabecalho[27 + i] = s));
  const pg = Buffer.concat([cabecalho, ...pacotes]);
  pg.writeUInt32LE(crcOgg(pg), 22);
  return pg;
}

/** WebM/Opus → Ogg/Opus (RFC 7845). */
export function webmParaOgg(webm: Buffer): Buffer {
  const { opusHead, pacotes } = lerWebmOpus(webm);
  const preSkip = BigInt(opusHead.readUInt16LE(10));
  const serie = 0x4d47 + (webm.length & 0xffff); // qualquer número fixo por arquivo serve
  const vendor = Buffer.from("Menezes Gestao", "latin1");
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
  tags.write("OpusTags", 0, "latin1");
  tags.writeUInt32LE(vendor.length, 8);
  vendor.copy(tags, 12);
  tags.writeUInt32LE(0, 12 + vendor.length);

  const paginas = [pagina([opusHead], 0n, serie, 0, 0x02), pagina([tags], 0n, serie, 1, 0x00)];
  let amostras = 0n;
  let lote: Buffer[] = [];
  let segmentosNoLote = 0;
  for (let i = 0; i < pacotes.length; i++) {
    const p = pacotes[i];
    const segs = Math.floor(p.length / 255) + 1;
    if (lote.length && (segmentosNoLote + segs > 255 || lote.length >= 50)) {
      paginas.push(pagina(lote, preSkip + amostras, serie, paginas.length, 0x00));
      lote = [];
      segmentosNoLote = 0;
    }
    lote.push(p);
    segmentosNoLote += segs;
    amostras += BigInt(amostrasOpus(p));
  }
  paginas.push(pagina(lote, preSkip + amostras, serie, paginas.length, 0x04));
  return Buffer.concat(paginas);
}

/** Prepara um áudio enviado pela tela: WebM vira Ogg (mensagem de voz); outros formatos seguem como arquivo de áudio. */
export function prepararAudio(conteudo: Buffer, mime: string): { conteudo: Buffer; mime: string; voz: boolean; extensao: string } {
  if (/webm/i.test(mime) || conteudo.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { conteudo: webmParaOgg(conteudo), mime: "audio/ogg", voz: true, extensao: "ogg" };
  }
  if (/ogg|opus/i.test(mime)) return { conteudo, mime: "audio/ogg", voz: true, extensao: "ogg" };
  const extensao = /mp4|m4a|aac/i.test(mime) ? "m4a" : /mpeg|mp3/i.test(mime) ? "mp3" : "audio";
  return { conteudo, mime, voz: false, extensao };
}
