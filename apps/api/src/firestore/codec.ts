/** Firestore REST `Value` codec. Integers are the only numeric type allowed (Principle I). */
export type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export type Fields = Record<string, FirestoreValue>;
export type Data = Record<string, unknown>;

export function encodeValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError(`Only safe integers can be stored: ${value}`);
    return { integerValue: String(value) };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return value.length === 0 ? { arrayValue: {} } : { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === 'object') {
    const fields = encodeFields(value as Data);
    return Object.keys(fields).length === 0 ? { mapValue: {} } : { mapValue: { fields } };
  }
  throw new TypeError(`Unsupported value type: ${typeof value}`);
}

export function encodeFields(data: Data): Fields {
  const fields: Fields = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) fields[key] = encodeValue(value);
  }
  return fields;
}

export function decodeValue(value: FirestoreValue): unknown {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) {
    const n = Number(value.integerValue);
    if (!Number.isSafeInteger(n)) throw new RangeError(`Unsafe integer in Firestore: ${value.integerValue}`);
    return n;
  }
  if ('doubleValue' in value) {
    if (!Number.isSafeInteger(value.doubleValue)) {
      throw new RangeError(`Non-integer number in Firestore: ${value.doubleValue}`);
    }
    return value.doubleValue;
  }
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {});
  throw new TypeError('Unsupported Firestore value');
}

export function decodeFields(fields: Fields): Data {
  const data: Data = {};
  for (const [key, value] of Object.entries(fields)) data[key] = decodeValue(value);
  return data;
}
