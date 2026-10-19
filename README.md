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

다른 사람도 같은 기록을 보고 고치려면 공유 저장소가 필요합니다. 이 프로젝트는 **Firebase Realtime Database** 와 **Firebase Authentication** 을 씁니다. 로그인하지 않은 사람은 팀 인원 수만 볼 수 있고, 휴가 기록은 로그인한 계정만 읽고 수정할 수 있습니다.

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
3. **Build → Authentication → Sign-in method** 에서 **이메일/비밀번호** 를 켭니다. 앱이 아이디를 내부 이메일로 바꿔 로그인하므로, 비밀번호 재설정 메일은 쓰지 않습니다.
4. 이 저장소의 새 화면을 먼저 배포하거나 로컬에서 한 번 연 뒤, 관리자와 기존 직원이 **한 번씩 로그인** 합니다. 그때 기존 비밀번호가 Firebase 로그인으로 옮겨집니다.
5. 그 다음 Realtime Database **규칙** 에 `database.rules.json` 내용을 붙여 넣고 게시합니다. 규칙을 먼저 닫으면, 아직 옮기지 못한 직원은 관리자가 비밀번호를 다시 설정해야 합니다.
6. 프로젝트 설정(톱니바퀴) → **내 앱** → 웹 앱(`</>`) 추가
7. 나온 설정값을 `src/firebaseConfig.js` 에 붙여 넣습니다.

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

8. 다시 실행해서 화면 오른쪽 위가 **공유 저장 중** 인지 확인합니다.

```powershell
npm run dev
```

사람·휴가 기록은 앱 코드가 아니라 Realtime Database에 저장됩니다. 화면 오른쪽 위가 **공유 저장 중** 이면 연결된 것입니다.

로그인한 사람만 휴가 기록을 수정할 수 있습니다. 관리자 비밀번호는 앱 소스에 들어 있으므로, 규칙을 적용한 뒤 Firebase 콘솔의 Authentication에서 `admin@users.company-vacation.app` 비밀번호를 바꾸면 소스에 적힌 값으로는 더 이상 로그인할 수 없습니다.

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

첫 화면은 대시보드입니다. **TA 팀 / DBA 팀** 인원만 보이며, PM은 집계에서 빠집니다. PL은 소속 팀(TA/DBA) 인원에 포함됩니다.

**계정 만들기**

- 이름, 아이디, 비밀번호, 팀(TA/DBA), 직급(팀원/PL/PM), 입사일을 넣고 가입합니다.
- 비밀번호는 6자 이상입니다.
- 가입 뒤에는 자기 휴가 등록/삭제, 정보 수정, 비밀번호 변경을 할 수 있습니다. 다른 사람 기록은 볼 수만 있습니다.

**로그인**

- 직원: 만든 아이디/비밀번호
- 관리자: 아이디 `admin` / 비밀번호 `ghdtnals`

**관리자**

- 모든 사람 휴가 조회, 팀/직급 수정, 비밀번호 변경, 계정 삭제가 가능합니다.

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
