/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = app.findCollectionByNameOrId("orders");

  collection.fields.addMarshaledJSON(JSON.stringify({
    type: "text",
    name: "order_number",
    presentable: true,
    required: false,
    max: 20,
  }));

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("orders");
  collection.fields.removeByName("order_number");
  return app.save(collection);
});
