/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = new Collection({
    name: "orders",
    type: "base",
    fields: [
      {
        name: "email",
        type: "email",
        required: true,
      },
      {
        name: "name",
        type: "text",
        required: true,
        min: 1,
        max: 200,
      },
      {
        name: "organization",
        type: "text",
        required: false,
        max: 200,
      },
      {
        name: "config",
        type: "json",
        required: true,
        maxSize: 50000,
      },
      {
        name: "monthly_total",
        type: "number",
        required: true,
        min: 0,
      },
      {
        name: "annual_total",
        type: "number",
        required: true,
        min: 0,
      },
      {
        name: "status",
        type: "select",
        required: true,
        values: ["new", "contacted", "quoted", "signed", "cancelled"],
      },
      {
        name: "notes",
        type: "text",
        required: false,
        max: 5000,
      },
    ],
  });

  // Default status for new records
  collection.fields.find(f => f.name === "status").presentable = true;

  // API rules: anonymous create only
  collection.createRule = "";       // anyone can create
  collection.listRule = null;       // auth required
  collection.viewRule = null;       // auth required
  collection.updateRule = null;     // auth required
  collection.deleteRule = null;     // auth required

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("orders");
  return app.delete(collection);
});
