# Contributors の追加方法

`js/data/contributors.js` の `CONTRIBUTORS` 配列に1件ずつオブジェクトを追加してください。

```js
const CONTRIBUTORS = [
  {
    name: "表示名",
    role: "Developer / Artist / Tester など",
    image: "./funkin-studio/images/example.png",
    description: "担当したこと",
    links: [
      { label: "GitHub", url: "https://github.com/example" },
      { label: "Website", url: "https://example.com" }
    ]
  }
];
```

画像は省略できます。ローカル画像を追加する場合は、例のように `funkin-studio/images/` に配置し、ルート `index.html` からの相対パスを指定します。公開する名前・画像・リンクは本人の許可を確認してください。

**単一HTML版について:** ビルド時に `CONTRIBUTORS` のローカル画像もHTML内へ埋め込まれます。外部URLの画像はオフラインでは表示できません。

ビルド: `python funkin-studio/build.py`
