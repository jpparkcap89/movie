# 링크 저장소 (개인용)

공개 게시물 링크를 넣으면 사진과 영상을 내 기기에 받거나 **구글 드라이브에 바로 저장**하는 개인용 웹 앱입니다.

```
[GitHub Pages: frontend/]  ──POST(JSON)──▶  [Apps Script 웹 앱: backend/Code.gs]
                                              ├─ 게시물 분석 (페이지의 og 태그와 JSON에서 파일 주소 찾기)
                                              ├─ 다운로드 (20MB 이하는 대신 받아서 전달, 더 크면 원본 링크)
                                              ├─ 드라이브 저장 (32MB씩 나눠 받아 이어 올리기)
                                              └─ 기록 → 구글 시트(logs, counters)
```

## 1. 백엔드 (구글 시트 + Apps Script)

1. 새 구글 시트를 만들고 **확장 프로그램 → Apps Script**를 엽니다.
2. `Code.gs` 내용을 지우고 [backend/Code.gs](backend/Code.gs)를 붙여넣습니다.
3. **프로젝트 설정(⚙) → "편집기에서 'appsscript.json' 매니페스트 파일 표시"**를 켜고, `appsscript.json`을 [backend/appsscript.json](backend/appsscript.json) 내용으로 바꿉니다.
4. 함수 목록에서 `setup`을 골라 **실행**하고 권한을 허용합니다.
   - 시트에 `logs`, `counters` 탭이 생깁니다.
   - **실행 로그에 비밀 키(API_KEY)가 나옵니다.** 복사해 두세요. (잊으면 프로젝트 설정 → 스크립트 속성에서 볼 수 있어요.)
5. **배포 → 새 배포 → 유형: 웹 앱**
   - 다음 사용자로 실행: **나**
   - 액세스 권한: **모든 사용자**
   - 배포 후 나오는 `https://script.google.com/macros/s/…/exec` 주소를 복사합니다.

> 코드를 고친 뒤에는 **배포 → 배포 관리 → 수정(연필) → 버전: 새 버전**으로 다시 배포해야 반영돼요. 이렇게 하면 주소는 그대로 유지됩니다.

"모든 사용자"로 공개해도 비밀 키가 없는 요청은 모두 거절됩니다.

## 2. 프론트엔드 (GitHub Pages)

1. [frontend/config.js](frontend/config.js)의 `API_URL`에 위에서 복사한 웹 앱 주소를 넣습니다.
2. `frontend/` 안의 파일 6개(`index.html`, `styles.css`, `lucian.css`, `ui.js`, `app.js`, `config.js`)를 GitHub 저장소 최상위에 올립니다.
3. 저장소 **Settings → Pages → Branch: main / (root)** 를 저장하면 `https://아이디.github.io/저장소이름/` 에서 열립니다.
4. 처음 쓸 때 비밀 키를 물어보면 4번에서 복사한 키를 넣습니다. 키는 그 브라우저에만 저장돼요.

> 비밀 키는 `config.js`나 저장소에 넣지 마세요. 공개 저장소면 누구나 볼 수 있어요.

## 3. 지원 범위와 한계

| 플랫폼 | 내 기기로 받기 | 드라이브 저장 | 참고 |
|---|---|---|---|
| Instagram | 사진 ○ / 영상 △ | ○ | 구글 서버 IP를 막으면 로그인 화면만 와서 실패해요 |
| Threads | 사진 ○ / 영상 △ | ○ | Instagram과 같은 CDN을 써요 |
| Facebook | 영상 △ | ○ | 공개 릴스/영상만, 페이지 구조가 자주 바뀌어요 |
| YouTube | 썸네일만 | 썸네일만 | 영상 파일은 서명 해독이 필요해서 GAS로는 불가능해요 |

- △ = 20MB 이하는 바로 저장, 그보다 크면 새 탭에서 원본을 열어 직접 저장
- **드라이브 저장은 50MB 한도가 없어요.** 32MB씩 나눠 옮기기 때문인데, 한 번 실행이 6분을 넘으면 멈춰요(대략 수백 MB까지).
- 분석한 원본 주소는 몇 시간 뒤 만료돼요. 오래 지나면 다시 분석하세요.
- 플랫폼이 페이지 구조를 바꾸면 분석이 깨질 수 있어요. `Code.gs`의 `analyze_` 안 정규식을 고치면 됩니다.

## 4. 설정 바꾸기

`Code.gs` 맨 위 `CONFIG`:

| 항목 | 기본값 | 설명 |
|---|---|---|
| `PER_IP_DAILY` | 100 | 하루 횟수 상한 (실수 방지용) |
| `GLOBAL_BYTES_DAILY` | 10 GiB | 하루 전송량 상한 |
| `MAX_PROXY_BYTES` | 20 MB | GAS가 대신 받아 브라우저로 넘겨 줄 최대 크기 |
| `DRIVE_FOLDER_ID` | 지정한 폴더 | 저장할 드라이브 폴더 ID (폴더 주소의 `folders/` 뒤 부분) |
| `DRIVE_FOLDER_NAME` | 링크 저장소 | `DRIVE_FOLDER_ID`를 비웠을 때 새로 만들 폴더 이름 |

**드라이브 폴더 공유 설정은 필요 없습니다.** 웹 앱은 "나(배포한 계정)" 권한으로 실행되므로, 그 계정이 폴더의 소유자나 편집자이기만 하면 됩니다. "링크가 있는 모든 사용자 → 편집자"로 열어 두면 누구나 파일을 지우거나 올릴 수 있으니 **제한됨**으로 두세요.

비밀 키를 바꾸려면 `resetKey`를 실행하세요.

## 디자인

- 페이지 배치·색·글꼴: cap89 스타일 (파스텔 배경, 유리 카드, 그라데이션 제목, Pretendard)
- 움직이는 부품: [Lucian UX/UI Prompt](https://lucianlabs.dev/uxui-prompt/) (MIT License © 2026 Seokwoooo). `lucian.css`, `ui.js`에 있고, 각 요소 위에 라이선스 주석을 남겨 두었습니다.

| 요소 | 쓰인 곳 |
|---|---|
| [#025 테두리로 떠오르는 라벨 입력](https://lucianlabs.dev/uxui-prompt/#025) | 게시물 주소 칸, 비밀 키 칸 |
| [#438 로딩→완료 버튼](https://lucianlabs.dev/uxui-prompt/#438) | 링크 분석하기 |
| [#031 맞춤 선택 목록](https://lucianlabs.dev/uxui-prompt/#031) | 저장할 항목 고르기 |
| [#004 진행률 다운로드 버튼](https://lucianlabs.dev/uxui-prompt/#004) | 내 기기로 / 드라이브로 저장 |
| [#435 토스트 알림](https://lucianlabs.dev/uxui-prompt/#435) | 완료·오류 알림 |

GAS는 응답을 한 번에 돌려주기 때문에 진짜 진행률을 알 수 없습니다. 그래서 저장 버튼의 막대는 기다리는 동안 90%까지 천천히 차오르고, 응답이 오면 100%로 끝납니다.

## 참고

혼자 쓰는 용도로 만들었어요. 각 플랫폼의 약관과 저작권을 지켜서, 직접 만들었거나 저장해도 되는 콘텐츠에만 쓰세요.
