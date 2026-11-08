/* ============================================================
   core/appInfo.js — アプリ名と「対応している V-Slice のバージョン」を1か所で決める
   ------------------------------------------------------------
   ヘッダーの表示と、書き出す character.json の generatedBy は、どちらもここから作る。
   対応バージョンが変わったら SUPPORTED_VERSIONS だけを書き換えればよい。
   ============================================================ */
export const APP_NAME = "Funkin' Studio";
/** 現在サポートしている V-Slice のバージョン範囲 */
export const SUPPORTED_VERSIONS = "0.8.6-0.8.8";
/** 書き出す JSON の generatedBy（ユーザーは変更できない。常にこの値で上書きする） */
export const GENERATED_BY = `${APP_NAME} (${SUPPORTED_VERSIONS})`;
