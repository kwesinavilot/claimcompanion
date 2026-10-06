import { readFileSync } from 'node:fs';

export interface CustomerRecord {
  tenantId: string;
  customer: { externalCustomerId: string; firstName: string; lastName: string; phone: string; email: string };
  policies: { policyNumber: string; status: string; effectiveDate: string; expirationDate: string;
    vehicles: { vehicleRegistrationNumber: string; vin: string; make: string; model: string; modelYear: number; color: string }[];
    coverages: { type: string; currency: string; limit?: string; deductible?: string }[] }[];
}

export const customers: CustomerRecord[] = JSON.parse(readFileSync(new URL('../../seed/customers.json', import.meta.url), 'utf8'));
export const claimTypes = [
  { code: 'MOTOR_COLLISION', label: 'Motor Collision', requiredFields: ['incidentAt', 'incidentLocation', 'vehicleRegistrationNumber', 'narrative'] },
  { code: 'MOTOR_HIT_AND_RUN', label: 'Motor Hit and Run', requiredFields: ['incidentAt', 'incidentLocation', 'narrative'] },
  { code: 'MOTOR_THEFT', label: 'Motor Theft', requiredFields: ['incidentAt', 'incidentLocation', 'policeReportNumber'] },
  { code: 'MOTOR_GLASS', label: 'Motor Glass Only', requiredFields: ['incidentAt', 'narrative'] },
  { code: 'MOTOR_WEATHER', label: 'Motor Weather or Falling Object', requiredFields: ['incidentAt', 'incidentLocation', 'narrative'] },
];
