/// <reference path="../pb_data/types.d.ts" />

// Shared checklist state for the /plans/ decks
// (src/_includes/components/plan-checklist.njk).
// One record per tickable item; `item` is the item's own text.
migrate((app) => {
  const collection = new Collection({
    name: "plan_checks",
    type: "base",
    fields: [
      {
        name: "page",
        type: "text",
        required: true,
        min: 1,
        max: 200,
      },
      {
        name: "item",
        type: "text",
        required: true,
        min: 1,
        max: 500,
      },
      {
        name: "label",
        type: "text",
        required: false,
        max: 500,
      },
      {
        name: "checked",
        type: "bool",
        required: false,
      },
      {
        name: "updated",
        type: "autodate",
        onCreate: true,
        onUpdate: true,
      },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_plan_checks_page_item ON plan_checks (page, item)",
    ],
  });

  collection.fields.find(f => f.name === "label").presentable = true;

  // API rules: anyone can read, superusers only can write
  collection.listRule = "";         // public
  collection.viewRule = "";         // public
  collection.createRule = null;     // superusers only
  collection.updateRule = null;     // superusers only
  collection.deleteRule = null;     // superusers only

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("plan_checks");
  return app.delete(collection);
});
