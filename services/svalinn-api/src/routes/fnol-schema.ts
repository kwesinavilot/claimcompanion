import { claimTypes } from '../store/seed.js';

const text = { type: 'string', minLength: 1 };
const nullableText = { anyOf: [text, { type: 'null' }] };
export const fnolProperties = {
  externalCustomerId: text,
  policyNumber: text,
  claimTypeCode: { type: 'string', enum: claimTypes.map(type => type.code) },
  vehicleRegistrationNumber: text,
  incidentAt: { type: 'string', format: 'date-time' },
  dateConfidence: { type: 'string', enum: ['exact', 'approximate', 'unsure'] },
  incidentLocation: { type: 'object', additionalProperties: false, properties: { description: text, city: text, region: text } },
  narrative: text,
  anyoneInjured: { type: 'boolean' },
  vehicleDrivable: { type: 'boolean' },
  otherParties: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    role: { type: 'string', enum: ['OTHER_DRIVER', 'PASSENGER', 'PEDESTRIAN', 'WITNESS'] },
    name: nullableText, phone: nullableText, plateNumber: nullableText, insurerName: nullableText,
  } } },
  policeReportNumber: nullableText,
};

export const createFnolSchema = { type: 'object', additionalProperties: false, properties: fnolProperties,
  required: ['claimTypeCode'], anyOf: [{ required: ['externalCustomerId'] }, { required: ['policyNumber'] }] };
export const patchFnolSchema = { type: 'object', additionalProperties: false, properties: fnolProperties };
