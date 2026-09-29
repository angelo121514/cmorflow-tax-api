import { DOMParser } from '@xmldom/xmldom';

export interface DtePrintAdjustment {
  movement: 'D' | 'R';
  value: number;
  /** Valor léxico del XML firmado, necesario para no redondear decimales al imprimir. */
  rawValue: string;
  valueType: '%' | '$';
  label?: string;
}

/**
 * Datos que se pueden representar visualmente en un DTE. Se construyen desde
 * el XML firmado, de modo que el PDF no pueda inventar ni recalcular valores
 * tributarios.
 */
export interface DtePrintModel {
  type: number;
  folio: number;
  issueDate: string;
  emitter: {
    rut: string;
    businessName: string;
    giro?: string;
    address?: string;
    commune?: string;
    city?: string;
  };
  receiver: {
    rut: string;
    businessName: string;
    giro?: string;
    address?: string;
    commune?: string;
    city?: string;
  };
  items: Array<{
    line: string;
    name: string;
    quantity?: string;
    unitPrice?: number;
    /** Precio unitario tal como quedó firmado (PrcItem admite hasta 6 decimales). */
    unitPriceText?: string;
    adjustments: DtePrintAdjustment[];
    amount: number;
    exempt: boolean;
  }>;
  totals: {
    netAmount?: number;
    exemptAmount?: number;
    ivaRate?: string;
    ivaAmount?: number;
    adjustments: DtePrintAdjustment[];
    retentions: Array<{
      type?: string;
      rate?: string;
      amount: number;
    }>;
    totalAmount: number;
  };
  references: Array<{
    line: string;
    documentType?: string;
    folio?: string;
    date?: string;
    reason?: string;
  }>;
  transport?: {
    departureDate?: string;
    departureTime?: string;
    arrivalDate?: string;
    carrierRut?: string;
    originAddress?: string;
    originCommune?: string;
    destinationAddress?: string;
    destinationCommune?: string;
    driverRut?: string;
    driverName?: string;
    vehiclePlate?: string;
    trailerPlate?: string;
  };
  tedXml: string;
}

// @xmldom/xmldom usa sus propias interfaces DOM, incompatibles de forma
// nominal con las del lib.dom de TypeScript. Este módulo sólo necesita la
// superficie común de nodos/elementos y la mantiene encapsulada aquí.
type XmlElement = any;

const MAX_DTE_DETAIL_ITEMS = 1000;
const MAX_DTE_ITEM_NAME_LENGTH = 80;

const elementChildren = (element: XmlElement): XmlElement[] => {
  const children: XmlElement[] = [];
  const nodes = element.childNodes;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes.item(index);
    if (node?.nodeType === 1) children.push(node);
  }
  return children;
};

const elementName = (element: XmlElement): string =>
  (element.localName || element.nodeName.split(':').pop() || '').trim();

const directChild = (element: XmlElement, name: string): XmlElement | undefined =>
  elementChildren(element).find((child) => elementName(child) === name);

const directChildren = (element: XmlElement, name: string): XmlElement[] =>
  elementChildren(element).filter((child) => elementName(child) === name);

const findDescendant = (element: XmlElement, name: string): XmlElement | undefined => {
  if (elementName(element) === name) return element;
  for (const child of elementChildren(element)) {
    const match = findDescendant(child, name);
    if (match) return match;
  }
  return undefined;
};

const text = (element: XmlElement | undefined): string | undefined => {
  const value = element?.textContent?.trim();
  return value || undefined;
};

const childText = (element: XmlElement, name: string): string | undefined => text(directChild(element, name));

const requiredText = (element: XmlElement, name: string, context: string): string => {
  const value = childText(element, name);
  if (!value) {
    throw new Error(`El XML firmado no contiene <${name}> en ${context}; no se puede generar una representación PDF fiel.`);
  }
  return value;
};

const decimal = (value: string | undefined, context: string): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`El valor ${context} del XML firmado no es numérico.`);
  }
  return parsed;
};

const requiredInteger = (value: string, context: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`El valor ${context} del XML firmado no es un entero válido.`);
  }
  return parsed;
};

const adjustmentMovement = (element: XmlElement, context: string): 'D' | 'R' => {
  const movement = requiredText(element, 'TpoMov', context);
  if (movement !== 'D' && movement !== 'R') {
    throw new Error(`El ajuste ${context} del XML firmado no tiene un tipo de movimiento válido.`);
  }
  return movement;
};

const adjustmentValueType = (element: XmlElement, context: string): '%' | '$' => {
  const valueType = requiredText(element, 'TpoValor', context);
  if (valueType !== '%' && valueType !== '$') {
    throw new Error(`El ajuste ${context} del XML firmado no tiene una unidad válida.`);
  }
  return valueType;
};

const adjustmentValue = (
  element: XmlElement,
  field: string,
  context: string,
  valueType: '%' | '$',
): Pick<DtePrintAdjustment, 'value' | 'rawValue'> => {
  const rawValue = requiredText(element, field, context);
  const value = decimal(rawValue, `${field} de ${context}`)!;
  if (value < 0 || (valueType === '%' && value > 100)) {
    throw new Error(`El valor ${field} de ${context} no es válido para su unidad.`);
  }
  return { value, rawValue };
};

const parseDetailAdjustments = (detail: XmlElement, index: number): DtePrintAdjustment[] => {
  const context = `detalle ${index + 1}`;
  const standardDefinitions: Array<{ field: string; movement: 'D' | 'R'; valueType: '%' | '$' }> = [
    { field: 'DescuentoPct', movement: 'D', valueType: '%' },
    { field: 'DescuentoMonto', movement: 'D', valueType: '$' },
    { field: 'RecargoPct', movement: 'R', valueType: '%' },
    { field: 'RecargoMonto', movement: 'R', valueType: '$' },
  ];
  const standardAdjustments = standardDefinitions
    .filter(({ field }) => !!directChild(detail, field))
    .map(({ field, movement, valueType }) => ({
      movement,
      valueType,
      ...adjustmentValue(detail, field, context, valueType),
    }));

  if (standardAdjustments.length > 0) return standardAdjustments;

  // Compatibilidad de lectura para XML histórico emitido antes de adoptar el
  // esquema SII actual. Un DscItem estándar es texto simple y no entra aquí.
  const legacy = directChild(detail, 'DscItem');
  if (legacy && directChild(legacy, 'ValorCF')) {
    return [{
      movement: 'D',
      valueType: '$',
      ...adjustmentValue(legacy, 'ValorCF', context, '$'),
    }];
  }
  return [];
};

const parseGlobalAdjustments = (documento: XmlElement, totals: XmlElement): DtePrintAdjustment[] => {
  const standard = directChildren(documento, 'DscRcgGlobal');
  const legacy = directChildren(totals, 'DscRcgloGlobal');
  if (standard.length > 0 && legacy.length > 0) {
    throw new Error('El XML firmado mezcla ajustes globales estándar y heredados; no se puede representar fielmente.');
  }
  if (standard.length > 0) {
    return standard.map((adjustment) => {
      const context = 'ajuste global';
      const valueType = adjustmentValueType(adjustment, context);
      return {
        movement: adjustmentMovement(adjustment, context),
        label: childText(adjustment, 'GlosaDR'),
        valueType,
        ...adjustmentValue(adjustment, 'ValorDR', context, valueType),
      };
    });
  }

  // Compatibilidad de lectura para documentos históricos con la estructura
  // anterior. La aplicación ya no vuelve a generar esta variante.
  return legacy.map((adjustment) => ({
    movement: adjustmentMovement(adjustment, 'ajuste global heredado'),
    label: childText(adjustment, 'Glosa'),
    valueType: '$' as const,
    ...adjustmentValue(adjustment, 'ValorCF', 'ajuste global heredado', '$'),
  }));
};

const extractTed = (xml: string): string => {
  const match = /<(?:[\w.-]+:)?TED\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?TED\s*>/i.exec(xml);
  if (!match) {
    throw new Error('El XML firmado no contiene un TED; no se puede generar un PDF tributario sin timbre electrónico.');
  }
  return match[0].trim();
};

/**
 * Parsea sólo el XML almacenado para el DTE. No admite DOCTYPE ni sustituye
 * valores ausentes con defaults de interfaz.
 */
export function buildDtePrintModel(xml: string): DtePrintModel {
  if (!xml?.trim()) {
    throw new Error('El DTE no tiene XML firmado disponible para generar el PDF.');
  }
  if (/<!DOCTYPE\b/i.test(xml)) {
    throw new Error('El XML del DTE contiene una declaración DOCTYPE no permitida.');
  }

  const parseErrors: string[] = [];
  const document = new DOMParser({
    errorHandler: (level, message) => {
      if (level !== 'warning') parseErrors.push(message);
    },
  }).parseFromString(xml, 'application/xml');

  if (parseErrors.length > 0 || !document.documentElement) {
    throw new Error(`No se pudo interpretar el XML firmado del DTE: ${parseErrors[0] || 'documento vacío'}.`);
  }

  const documento = findDescendant(document.documentElement, 'Documento');
  if (!documento) {
    throw new Error('El XML firmado no contiene el nodo <Documento> del DTE.');
  }
  const encabezado = directChild(documento, 'Encabezado');
  const idDoc = encabezado && directChild(encabezado, 'IdDoc');
  const emisor = encabezado && directChild(encabezado, 'Emisor');
  const receptor = encabezado && directChild(encabezado, 'Receptor');
  const totals = encabezado && directChild(encabezado, 'Totales');
  if (!encabezado || !idDoc || !emisor || !receptor || !totals) {
    throw new Error('El XML firmado no contiene el encabezado tributario completo requerido para imprimir el DTE.');
  }

  const detailNodes = directChildren(documento, 'Detalle');
  if (detailNodes.length > MAX_DTE_DETAIL_ITEMS) {
    throw new Error(`El XML firmado contiene más de ${MAX_DTE_DETAIL_ITEMS} líneas de detalle; supera el máximo permitido por el formato DTE.`);
  }

  const items = detailNodes.map((detail, index) => {
    const unitPriceText = childText(detail, 'PrcItem');
    const name = requiredText(detail, 'NmbItem', `Detalle ${index + 1}`);
    if (Array.from(name).length > MAX_DTE_ITEM_NAME_LENGTH) {
      throw new Error(`El XML firmado contiene un NmbItem de más de ${MAX_DTE_ITEM_NAME_LENGTH} caracteres en Detalle ${index + 1}; no se puede generar una representación PDF fiel.`);
    }
    return {
      line: childText(detail, 'NroLinDet') || String(index + 1),
      name,
      quantity: childText(detail, 'QtyItem'),
      unitPrice: decimal(unitPriceText, `PrcItem de detalle ${index + 1}`),
      unitPriceText,
      adjustments: parseDetailAdjustments(detail, index),
      amount: decimal(requiredText(detail, 'MontoItem', `Detalle ${index + 1}`), `MontoItem de detalle ${index + 1}`)!,
      exempt: childText(detail, 'IndExe') === '1',
    };
  });
  if (items.length === 0) {
    throw new Error('El XML firmado no contiene líneas de detalle; no se puede generar un PDF tributario fiel.');
  }

  const printTotals = {
    netAmount: decimal(childText(totals, 'MntNeto'), 'MntNeto'),
    exemptAmount: decimal(childText(totals, 'MntExe'), 'MntExe'),
    ivaRate: childText(totals, 'TasaIVA'),
    ivaAmount: decimal(childText(totals, 'IVA'), 'IVA'),
    adjustments: parseGlobalAdjustments(documento, totals),
    retentions: directChildren(totals, 'ImptoReten').map((retention) => ({
      type: childText(retention, 'TipoImp'),
      rate: childText(retention, 'TasaImp'),
      amount: decimal(requiredText(retention, 'MontoImp', 'ImptoReten'), 'MontoImp de retención')!,
    })),
    totalAmount: decimal(requiredText(totals, 'MntTotal', 'Totales'), 'MntTotal')!,
  };

  const transport = directChild(encabezado, 'Transporte');
  const driver = transport && directChild(transport, 'Chofer');
  const printTransport = transport ? {
    departureDate: childText(transport, 'FchSalida'),
    departureTime: childText(transport, 'HraSalida'),
    arrivalDate: childText(transport, 'FchLlegada'),
    carrierRut: childText(transport, 'RUTTrans'),
    originAddress: childText(transport, 'DirOrigen'),
    originCommune: childText(transport, 'CmnaOrigen'),
    destinationAddress: childText(transport, 'DirDest'),
    destinationCommune: childText(transport, 'CmnaDest'),
    driverRut: childText(driver || transport, 'RUTChofer'),
    driverName: childText(driver || transport, 'NombreChofer'),
    vehiclePlate: childText(transport, 'Patente'),
    trailerPlate: childText(transport, 'PatenteAcoplado'),
  } : undefined;

  return {
    type: requiredInteger(requiredText(idDoc, 'TipoDTE', 'IdDoc'), 'TipoDTE'),
    folio: requiredInteger(requiredText(idDoc, 'Folio', 'IdDoc'), 'Folio'),
    issueDate: requiredText(idDoc, 'FchEmis', 'IdDoc'),
    emitter: {
      rut: requiredText(emisor, 'RUTEmisor', 'Emisor'),
      businessName: requiredText(emisor, 'RznSoc', 'Emisor'),
      giro: childText(emisor, 'GiroEmis'),
      address: childText(emisor, 'DirOrigen'),
      commune: childText(emisor, 'CmnaOrigen'),
      city: childText(emisor, 'CiudadOrigen'),
    },
    receiver: {
      rut: requiredText(receptor, 'RUTRecep', 'Receptor'),
      businessName: requiredText(receptor, 'RznSocRecep', 'Receptor'),
      giro: childText(receptor, 'GiroRecep'),
      address: childText(receptor, 'DirRecep'),
      commune: childText(receptor, 'CmnaRecep'),
      city: childText(receptor, 'CiudadRecep'),
    },
    items,
    totals: printTotals,
    references: directChildren(documento, 'Referencia').map((reference, index) => ({
      line: childText(reference, 'NroLinRef') || String(index + 1),
      documentType: childText(reference, 'TpoDocRef'),
      folio: childText(reference, 'FolioRef'),
      date: childText(reference, 'FchRef'),
      reason: childText(reference, 'RazonRef'),
    })),
    transport: printTransport,
    tedXml: extractTed(xml),
  };
}
