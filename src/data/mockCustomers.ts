import { Customer } from '../types';

/**
 * Starting customer list. These are placeholder accounts you can edit or quote
 * against out of the box — all activity metrics start at zero and are computed
 * live from real quotes as they are created (see CustomersPage / detail).
 */
export const mockCustomers: Customer[] = [
  {
    id: 'c1',
    name: 'Midwest Manufacturing Co.',
    contactName: 'Sarah Jenkins',
    email: 'sarah.j@midwestmfg.example.com',
    phone: '(555) 123-4567',
    address: '123 Industrial Way, Chicago, IL 60601',
    terms: 'Net 30',
    totalQuotes: 0,
    wonQuotes: 0,
    totalRevenue: 0,
  },
  {
    id: 'c2',
    name: 'Apex Industrial',
    contactName: 'Mike Ross',
    email: 'm.ross@apexind.example.com',
    phone: '(555) 987-6543',
    address: '456 Factory Ln, Detroit, MI 48201',
    terms: 'Net 15',
    totalQuotes: 0,
    wonQuotes: 0,
    totalRevenue: 0,
  },
  {
    id: 'c3',
    name: 'Ridgeline Fabrication',
    contactName: 'Elena Gilbert',
    email: 'elena@ridgeline.example.com',
    phone: '(555) 246-8135',
    address: '789 Mountain View, Denver, CO 80201',
    terms: 'Paid Upfront',
    totalQuotes: 0,
    wonQuotes: 0,
    totalRevenue: 0,
  },
];
