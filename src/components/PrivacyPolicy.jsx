const sectionStyle = { marginBottom: 28 };
const headingStyle = { margin: "0 0 10px", fontSize: 20, lineHeight: 1.4, color: "#0f172a" };
const paragraphStyle = { margin: "0 0 10px", color: "#334155", lineHeight: 1.75 };
const listStyle = { margin: "8px 0 0", paddingLeft: 22, color: "#334155", lineHeight: 1.8 };

export default function PrivacyPolicy() {
  return (
    <main style={{ minHeight: "100vh", background: "#f8fafc", color: "#0f172a", fontFamily: "'Pretendard','DM Sans',Arial,sans-serif" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "56px 24px 72px" }}>
        <header style={{ marginBottom: 44 }}>
          <a href="/" style={{ color: "#1d4ed8", textDecoration: "none", fontSize: 14, fontWeight: 700 }}>PROPOS</a>
          <h1 style={{ margin: "18px 0 10px", fontSize: 34, lineHeight: 1.25 }}>개인정보처리방침</h1>
          <p style={{ ...paragraphStyle, marginBottom: 0 }}>시행일: 2026년 10월 17일</p>
        </header>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>1. 목적</h2>
          <p style={paragraphStyle}>PROPOS(이하 “서비스”)는 숙소 운영, 예약 일정 확인, 청소 일정 배정과 관련된 업무를 지원합니다. 본 방침은 서비스가 Google API 등을 통해 처리하는 정보와 그 이용 방법을 설명합니다.</p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>2. 처리하는 정보</h2>
          <ul style={listStyle}>
            <li>Google Calendar 일정의 날짜·시간, 이벤트 식별자, 일정 제목, 참석자 및 청소 배정 관련 정보</li>
            <li>Google Gmail API를 통해 확인하는 Airbnb 예약 알림 메일의 예약·일정 처리에 필요한 정보</li>
            <li>서비스 운영 및 문의 대응에 필요한 계정·연락처 정보</li>
            <li>서비스 안정성 확인을 위한 접속·오류 기록</li>
          </ul>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>3. 이용 목적</h2>
          <ul style={listStyle}>
            <li>예약 일정과 숙소 정보를 동기화하고 청소 작업을 생성·관리</li>
            <li>Google Calendar 일정과 청소 담당자 배정 상태를 연결</li>
            <li>예약·청소 관련 알림과 운영 리포트를 제공</li>
            <li>서비스 오류를 확인하고 보안을 유지</li>
          </ul>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>4. Google 사용자 데이터의 이용</h2>
          <p style={paragraphStyle}>서비스는 사용자가 승인한 범위에서만 Google Calendar 및 Gmail API를 사용합니다. Google 사용자 데이터는 예약·청소 운영 기능을 제공하는 목적에만 사용하며, 판매하거나 광고 목적으로 이용하지 않습니다.</p>
          <p style={paragraphStyle}>서비스는 Google 사용자 데이터를 일반적인 인공지능 모델의 학습에 사용하지 않습니다.</p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>5. 보관 및 파기</h2>
          <p style={paragraphStyle}>정보는 서비스 운영과 정산·분쟁 대응에 필요한 기간 동안 보관합니다. 보관 목적이 달성되거나 이용자가 삭제를 요청하면 관련 법령상 보관 의무가 있는 경우를 제외하고 지체 없이 삭제합니다.</p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>6. 제3자 제공 및 처리 위탁</h2>
          <p style={paragraphStyle}>서비스는 기능 제공에 필요한 범위에서 Google API, 클라우드 호스팅 및 데이터 저장 서비스와 연동합니다. 법령상 요구되거나 이용자의 별도 동의가 있는 경우를 제외하고 개인정보를 판매하거나 제3자에게 임의로 제공하지 않습니다.</p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>7. 이용자의 권리</h2>
          <p style={paragraphStyle}>이용자는 Google 계정의 보안 설정에서 서비스의 Google 권한을 언제든지 철회할 수 있습니다. 개인정보 관련 문의나 삭제 요청은 아래 연락처로 요청할 수 있습니다.</p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>8. 보안</h2>
          <p style={paragraphStyle}>서비스는 접근 권한 관리, 비밀정보 보호 및 운영 로그 점검 등 합리적인 보호조치를 적용합니다.</p>
        </section>

        <section style={{ ...sectionStyle, marginBottom: 0 }}>
          <h2 style={headingStyle}>9. 문의</h2>
          <p style={paragraphStyle}>개인정보처리방침에 대한 문의: <a href="mailto:adcfirm@gmail.com">adcfirm@gmail.com</a></p>
        </section>
      </div>
    </main>
  );
}
