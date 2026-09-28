/**
 * AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-28.
 * Scope: Convert the supplied CSV into typed seed records. Author review: Done.
 * Source: data/csv/supplier-seed-data.csv (Windows-1252 encoding).
 * UUIDs are fixed seed identifiers; keep them stable when editing these records.
 * Com2 and Com 2 references are standardized to COM2 at the user's request.
 */
import type { suppliers } from "./schema.js";

type SupplierSeed = Pick<
  typeof suppliers.$inferInsert,
  "name" | "floor" | "locationDescription" | "latitude" | "longitude" | "imageUrl"
> & {
  id: string;
  typeName: string;
  buildingName: string;
  openingHrs: string;
  closingHrs: string;
};

export const supplierSeedData = [
  {
    "id": "083a765a-cf35-44f5-a789-8af15ba22534",
    "name": "Anna's x Soup Union",
    "typeName": "Food",
    "buildingName": "Central Library",
    "floor": "1",
    "locationDescription": "Next to NUS Co-op",
    "latitude": "1.296444",
    "longitude": "103.773032",
    "imageUrl": "https://github.com/CS3219-AY2627S1/FoC-Template/blob/main/data/images/ANNA.jpeg",
    "openingHrs": "09:00:00",
    "closingHrs": "18:00:00"
  },
  {
    "id": "65861c57-1ab2-4b35-9480-0664aee38a92",
    "name": "NUS Co-op",
    "typeName": "Shopping",
    "buildingName": "Central Library",
    "floor": "1",
    "locationDescription": "Inside the library on the right side",
    "latitude": "1.2967866",
    "longitude": "103.7732677",
    "imageUrl": "https://github.com/CS3219-AY2627S1/FoC-Template/blob/main/data/images/NUS_COOP.jpeg",
    "openingHrs": "09:00:00",
    "closingHrs": "16:00:00"
  },
  {
    "id": "59142f01-adc1-49a2-b832-611b276672c0",
    "name": "Printer @ COM2",
    "typeName": "Printing",
    "buildingName": "COM2",
    "floor": "1",
    "locationDescription": "Next to LT19",
    "latitude": "1.2938347",
    "longitude": "103.7744572",
    "imageUrl": "https://github.com/CS3219-AY2627S1/FoC-Template/blob/main/data/images/PRINTER_COM2.jpeg",
    "openingHrs": "00:00:00",
    "closingHrs": "23:59:00"
  },
  {
    "id": "3c60e4c4-9144-4d2d-8da2-12513e6038de",
    "name": "Cool Spot",
    "typeName": "Food",
    "buildingName": "COM2",
    "floor": "1",
    "locationDescription": "Opp LT16",
    "latitude": "1.2940156",
    "longitude": "103.7738478",
    "imageUrl": "https://github.com/CS3219-AY2627S1/FoC-Template/blob/main/data/images/COOL_SPOT.jpeg",
    "openingHrs": "09:00:00",
    "closingHrs": "21:30:00"
  },
  {
    "id": "d09417eb-3bd4-4d5f-b192-71fcc5d0c7f7",
    "name": "InstaChef",
    "typeName": "Food",
    "buildingName": "Terrace",
    "floor": "1",
    "locationDescription": "Next to foyer",
    "latitude": "1.2938898",
    "longitude": "103.7736305",
    "imageUrl": "https://github.com/CS3219-AY2627S1/FoC-Template/blob/main/data/images/INSTACHEF.jpeg",
    "openingHrs": "00:00:00",
    "closingHrs": "23:59:00"
  },
  {
    "id": "76271ad9-05f0-4585-8804-531a102d1aec",
    "name": "Cafe+ Robot Cafe",
    "typeName": "Food/Coffee",
    "buildingName": "Central Library",
    "floor": "1",
    "locationDescription": "Opp to central library entrance",
    "latitude": "1.296444",
    "longitude": "103.773032",
    "imageUrl": "https://github.com/CS3219-AY2627S1/FoC-Template/blob/main/data/images/ROBOT_CAFE.jpeg",
    "openingHrs": "00:00:00",
    "closingHrs": "23:59:00"
  },
  {
    "id": "ac6761fd-cfa4-4606-a5c9-36ee8872a049",
    "name": "A Hot Hideout",
    "typeName": "Food",
    "buildingName": "Prince George's Park",
    "floor": "2",
    "locationDescription": "Near PGP entrance",
    "latitude": "1.2908445",
    "longitude": "103.7770891",
    "imageUrl": null,
    "openingHrs": "11:00:00",
    "closingHrs": "21:30:00"
  },
  {
    "id": "e66ed4b2-12f1-4dbe-86c3-dc55b128268d",
    "name": "Arise and Shine",
    "typeName": "Food",
    "buildingName": "Engineering Block E4",
    "floor": "4",
    "locationDescription": "Near LT6",
    "latitude": "1.2991517",
    "longitude": "103.769064",
    "imageUrl": null,
    "openingHrs": "08:00:00",
    "closingHrs": "18:00:00"
  },
  {
    "id": "bc5f01fc-6c1b-41d2-a9e3-7935e8d1b936",
    "name": "Bakehaus / Aurea",
    "typeName": "Food",
    "buildingName": "The Ridge",
    "floor": "1",
    "locationDescription": "Near COM2",
    "latitude": "1.2946778",
    "longitude": "103.7707872",
    "imageUrl": null,
    "openingHrs": "08:00:00",
    "closingHrs": "21:00:00"
  },
  {
    "id": "f68f5a46-a342-470e-be55-ecf441bbe91b",
    "name": "Central Square @ YIH",
    "typeName": "Food",
    "buildingName": "Yusof Ishak House",
    "floor": "1",
    "locationDescription": "Closest to Opp UHC bus stop",
    "latitude": "1.2984401",
    "longitude": "103.7726256",
    "imageUrl": null,
    "openingHrs": "08:00:00",
    "closingHrs": "20:00:00"
  },
  {
    "id": "9b0c4d50-1972-4a33-ad57-a37445543916",
    "name": "Pasta Express",
    "typeName": "Food",
    "buildingName": "Frontier",
    "floor": "1",
    "locationDescription": "Aircon section",
    "latitude": "1.2947819",
    "longitude": "103.7704435",
    "imageUrl": null,
    "openingHrs": "09:30:00",
    "closingHrs": "19:30:00"
  },
  {
    "id": "e48c7fbb-5834-4220-9f02-8c46cd20f790",
    "name": "TOMORO COFFEE",
    "typeName": "Food/Coffee",
    "buildingName": "Hon Sui Sen Memorial Library",
    "floor": "2",
    "locationDescription": "Inside HSSML",
    "latitude": "1.2931259",
    "longitude": "103.7719943",
    "imageUrl": null,
    "openingHrs": "08:15:00",
    "closingHrs": "18:00:00"
  },
  {
    "id": "c2b960f2-cbee-4ac0-89fa-09da26a0550f",
    "name": "Octobox",
    "typeName": "Shopping",
    "buildingName": "Prince George’s Park",
    "floor": "2",
    "locationDescription": "Near PGP entrance",
    "latitude": "1.2904347",
    "longitude": "103.7787588",
    "imageUrl": null,
    "openingHrs": "00:00:00",
    "closingHrs": "23:59:00"
  },
  {
    "id": "a8b40f64-ed90-44ad-aeba-f43a439ebbdf",
    "name": "Smooy",
    "typeName": "Food",
    "buildingName": "COM3",
    "floor": "1",
    "locationDescription": "The Terrace @ COM3",
    "latitude": "1.2948308",
    "longitude": "103.7716305",
    "imageUrl": null,
    "openingHrs": "11:00:00",
    "closingHrs": "21:00:00"
  },
  {
    "id": "80dd2ed8-db96-4691-8645-dfc9ca0f56c4",
    "name": "Goh Bros E-Print Pte Ltd",
    "typeName": "Printing",
    "buildingName": "Yusof Ishak House",
    "floor": "5",
    "locationDescription": "Take the long staircase up YIH",
    "latitude": "1.2984905",
    "longitude": "103.7720544",
    "imageUrl": null,
    "openingHrs": "09:00:00",
    "closingHrs": "18:00:00"
  },
  {
    "id": "89df8233-e5b1-40ef-a154-00e5664e9fd7",
    "name": "Cheers Unmanned Convenience Store",
    "typeName": "Shopping",
    "buildingName": "Engineering Block E3",
    "floor": "4",
    "locationDescription": "Take right from Arise n Shine",
    "latitude": "1.2994341",
    "longitude": "103.7526298",
    "imageUrl": null,
    "openingHrs": "00:00:00",
    "closingHrs": "23:59:00"
  },
  {
    "id": "33b2fdcd-f762-44aa-8441-360a8a3a38af",
    "name": "Nami",
    "typeName": "Food",
    "buildingName": "innovation4.0",
    "floor": "1",
    "locationDescription": "Opp TCOMS",
    "latitude": "1.2942982",
    "longitude": "103.7708813",
    "imageUrl": null,
    "openingHrs": "08:00:00",
    "closingHrs": "17:30:00"
  },
  {
    "id": "3bd08f3f-17af-4c1f-906b-972012a896c5",
    "name": "Supersnacks",
    "typeName": "Food",
    "buildingName": "Prince George’s Park",
    "floor": "1",
    "locationDescription": "At level 1 in Prince George's Park Residences, Block 10",
    "latitude": "1.2913847",
    "longitude": "103.7776367",
    "imageUrl": null,
    "openingHrs": "11:00:00",
    "closingHrs": "02:00:00"
  },
  {
    "id": "3822c522-07d7-47b8-b446-0c3dc32febb6",
    "name": "Good Day Cafe",
    "typeName": "Food/Coffee",
    "buildingName": "Medicine+Science Library",
    "floor": "1",
    "locationDescription": "Inside MedScience library",
    "latitude": "1.2967989",
    "longitude": "103.7794336",
    "imageUrl": null,
    "openingHrs": "07:30:00",
    "closingHrs": "18:30:00"
  },
  {
    "id": "2c8deefa-d55b-4b50-9e05-58c77afda6af",
    "name": "The Coffee Roaster",
    "typeName": "Food/Coffee",
    "buildingName": "Blk AS8",
    "floor": "1",
    "locationDescription": "Behind central library bus stop",
    "latitude": "1.296252229",
    "longitude": "103.7720926",
    "imageUrl": null,
    "openingHrs": "08:00:00",
    "closingHrs": "17:30:00"
  },
  {
    "id": "4aefea04-2e37-4375-ab67-21b30a281d9d",
    "name": "he by He Brews",
    "typeName": "Food/Coffee",
    "buildingName": "Engineering Block EA",
    "floor": "1",
    "locationDescription": "Near LT7 & Engineering Auditorium",
    "latitude": "1.300566804",
    "longitude": "103.7707577",
    "imageUrl": null,
    "openingHrs": "08:00:00",
    "closingHrs": "17:00:00"
  }
] satisfies SupplierSeed[];
