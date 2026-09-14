# 휴가 관리기

여러 사람의 연차·반차·당직휴가를 한 웹 주소에서 같이 보고 수정하는 앱입니다.

GitHub Pages에 올리면 서버 없이 무료로 배포됩니다. 휴대폰 브라우저에서도 쓸 수 있습니다.

예시 주소:

```
https://smhong.github.io/vacation-tracker
```

## 왜 LocalStorage만 쓰지 않나요?

GitHub Pages는 정적 파일만 호스팅합니다. 브라우저 LocalStorage는 **그 기기, 그 브라우저에만** 남습니다.

그래서 노트북에서 넣은 휴가가 휴대폰이나 다른 사람 화면에는 보이지 않습니다.

다른 사람도 같은 기록을 보고 고치려면 공유 저장소가 필요합니다. 이 프로젝트는 **Firebase Realtime Database** 를 씁니다. 무료 한도 안에서 충분하고, 로그인 없이 URL만 알면 읽고 수정할 수 있습니다.

Firebase 설정을 넣기 전에는 이 브라우저에만 저장되는 미리보기 모드로 동작합니다.

## 준비물

- [Node.js 20 이상](https://nodejs.org/) (설치 후 터미널 재시작)
- GitHub 계정
- Google 계정 (Firebase용)

설치 확인:

```powershell
node -v
npm -v
```

## 로컬에서 먼저 실행

프로젝트 폴더에서:

```powershell
cd D:\vacation_tracker
npm install
npm run dev
```

터미널에 나온 주소로 엽니다. 보통 아래입니다.

```
http://localhost:5173
```

종료는 터미널에서 `Ctrl + C` 입니다.

이 상태에서는 데이터가 이 브라우저에만 저장됩니다. 사람 추가, 휴가 등록이 되는지만 확인하면 됩니다.

## 다른 사람과 같은 기록 쓰기 (Firebase)

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 프로젝트 추가
2. **Build → Realtime Database → Create Database**
   - 위치는 가까운 곳이면 됩니다
   - 시작은 **테스트 모드** 로 해도 됩니다
3. 규칙이 아래와 같은지 확인합니다. URL을 아는 사람은 누구나 읽고 쓸 수 있습니다.

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

4. 프로젝트 설정(톱니바퀴) → **내 앱** → 웹 앱(`</>`) 추가
5. 나온 설정값을 `src/firebaseConfig.js` 에 붙여 넣습니다.

```js
export const firebaseConfig = {
  apiKey: "붙여넣기",
  authDomain: "붙여넣기",
  databaseURL: "https://프로젝트id-default-rtdb.firebaseio.com",
  projectId: "붙여넣기",
  storageBucket: "붙여넣기",
  messagingSenderId: "붙여넣기",
  appId: "붙여넣기",
};
```

`databaseURL` 이 비어 있으면 공유가 되지 않습니다. Realtime Database를 만든 뒤 콘솔에 나오는 URL을 넣으세요.

6. 다시 실행해서 화면 오른쪽 위가 **공유 저장 중** 인지 확인합니다.

```powershell
npm run dev
```

처음 연결되면 기존 기록(홍수민)이 공유 DB에 들어갑니다. 그 다음부터는 누가 수정하든 같은 내용이 보입니다.

주소만 알면 누구나 수정할 수 있으니, 팀 내부 주소로만 공유하세요.

## GitHub Pages에 올리기

저장소 이름이 `vacation-tracker` 가 아니면 `vite.config.js` 의 `BASE_PATH` 를 `'/저장소이름/'` 으로 바꾸세요.

```powershell
cd D:\vacation_tracker
git init
git add .
git commit -m "Initial vacation tracker"
```

GitHub에서 빈 저장소 `vacation-tracker` 를 만든 뒤:

```powershell
git branch -M main
git remote add origin https://github.com/계정이름/vacation-tracker.git
git push -u origin main
```

GitHub 저장소에서:

1. **Settings → Pages**
2. Source를 **GitHub Actions** 로 선택
3. **Actions** 탭에서 `Deploy GitHub Pages` 워크플로가 초록색이 될 때까지 기다립니다

주소:

```
https://계정이름.github.io/vacation-tracker/
```

`src/firebaseConfig.js` 를 채운 채로 push 해야 배포된 사이트에서도 공유 저장이 됩니다. Firebase 웹 설정값은 원래 프론트에 노출되는 값입니다.

## 사용 방법

- 위쪽 이름 칩에서 사람을 고릅니다. **+ 사람** 으로 추가합니다.
- **휴가 사용 등록** 에서 연차(1일) / 반차(0.5일)을 넣습니다.
- 사용 내역의 **삭제** 로 잘못 넣은 건 지웁니다.
- **사람 수정** 에서 입사일·당직을 바꾸고, **이 사람 삭제** 는 그 사람 기록 전체를 지웁니다.
- 사람이 두 명 이상이면 **전체 현황** 이 보입니다.

계산 규칙:

- 입사일 다음 달부터, 매월 같은 날짜가 지나면 연차 1개
- 당직이 있으면 당직 시작일부터 설정한 일수(기본 21일)마다 당직휴가 1개
- 남은 휴가 = 총 발생 − 사용

## 자주 겪는 문제

**`npm` 을 찾을 수 없습니다**

Node.js를 설치하고 터미널을 닫았다가 다시 여세요.

**배포 사이트가 하얗게 나옵니다**

저장소 이름과 `vite.config.js` 의 `BASE_PATH` 가 다르면 발생합니다. Pages 주소의 `/뒤에오는이름/` 과 같게 맞춘 뒤 다시 push 하세요.

**다른 사람 화면에 내 수정이 안 보입니다**

`firebaseConfig.js` 가 비어 있거나, Realtime Database를 만들지 않았거나, `databaseURL` 이 빠진 경우입니다. 화면 오른쪽 위가 **공유 저장 중** 이어야 합니다.

**로컬에서는 보이는데 배포 사이트는 예전 화면입니다**

GitHub Actions가 아직 끝나지 않았거나, 브라우저 캐시입니다. Actions가 성공한 뒤 강력 새로고침(Ctrl + F5) 하세요.
