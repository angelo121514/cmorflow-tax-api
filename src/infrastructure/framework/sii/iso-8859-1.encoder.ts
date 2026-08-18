export class Iso88591Encoder {
  static encode(xml: string): Buffer {
    const invalidChar = [...xml].find((char) => char.codePointAt(0)! > 255);
    if (invalidChar) {
      throw new Error(
        `El XML contiene el caracter "${invalidChar}", que no puede codificarse en ISO-8859-1.`,
      );
    }

    return Buffer.from(xml, 'latin1');
  }

  static normalizeXmlDeclaration(xml: string): string {
    if (/^<\?xml/i.test(xml)) {
      return xml.replace(/^<\?xml[^>]*\?>/i, '<?xml version="1.0" encoding="ISO-8859-1"?>');
    }

    return `<?xml version="1.0" encoding="ISO-8859-1"?>\n${xml}`;
  }
}
